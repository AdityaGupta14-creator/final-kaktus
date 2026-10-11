export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { logSecurityEvent } from '@/lib/server/security-logger';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request) {
  try {
    await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE']);

    const snapshot = await db.collection('payments')
      .orderBy('createdAt', 'desc')
      .get();

    const payments = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: data.uid || '',
        email: data.email || null,
        planId: data.planId || '',
        txnId: data.txnId || '',
        status: data.status || 'pending',
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null,
      };
    });

    return Response.json({ payments });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE']);
    const body = await request.json();

    const { action, paymentId } = body;
    if (!paymentId || (action !== 'approve' && action !== 'reject')) {
      return Response.json({ error: 'Valid paymentId and action (approve|reject) are required.' }, { status: 400 });
    }

    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists) {
      return Response.json({ error: 'Payment transaction not found.' }, { status: 404 });
    }

    const paymentData = paymentSnap.data();
    if (!paymentData) {
      return Response.json({ error: 'Payment data unavailable.' }, { status: 500 });
    }

    if (paymentData.status !== 'pending') {
      return Response.json({ error: 'Payment has already been processed.' }, { status: 400 });
    }

    if (action === 'reject') {
      await paymentRef.update({
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: admin.email || admin.uid,
      });
      
      logSecurityEvent('PAYMENT_REJECTED', { uid: admin.uid, role: admin.role, email: admin.email || undefined }, {
        paymentId,
        uid: paymentData.uid,
      });
      
      return Response.json({ success: true, status: 'rejected' });
    }

    // Approve action
    // Check for duplicate payment in Supabase first (Idempotency)
    const { data: existingSub } = await adminSupabase
      .from('subscriptions')
      .select('quota_remaining, metadata')
      .eq('user_uid', paymentData.uid)
      .single();

    if (existingSub?.metadata?.last_payment_id === paymentId) {
      console.warn(`[Payments] Duplicate approval attempt detected for payment ${paymentId}`);
      // Fallback: fix Firestore state if it was left hanging
      const batch = db.batch();
      batch.update(paymentRef, {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: admin.email || admin.uid,
      });
      await batch.commit();
      return Response.json({ success: true, status: 'approved', note: 'Recovered from partial failure.' });
    }

    const { getPlanConfig } = await import('@/lib/server/plans');
    const planConfig = getPlanConfig(paymentData.planId);
    
    const userRef = db.collection('users').doc(paymentData.uid);
    const userSnap = await userRef.get();
    const currentProRuns = (userSnap.exists && userSnap.data()?.proRuns) ? Number(userSnap.data()?.proRuns) : 0;

    // Use existing quota from Supabase if available, else Firestore fallback
    const baseQuota = existingSub ? existingSub.quota_remaining : currentProRuns;

    // Calculate expiry
    const expiresAt = new Date();
    if (planConfig.durationDays > 0) {
      expiresAt.setDate(expiresAt.getDate() + planConfig.durationDays);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 100); // effectively no expiry
    }

    // Upsert the subscription in Supabase (the authoritative source)
    const { error: subError } = await adminSupabase.from('subscriptions').upsert({
      user_uid: paymentData.uid,
      plan_id: planConfig.id,
      status: 'active',
      quota_remaining: baseQuota + planConfig.proRuns,
      expires_at: expiresAt.toISOString(),
      metadata: { last_payment_id: paymentId, updated_by: admin.uid }
    }, { onConflict: 'user_uid' });

    if (subError) {
      console.error('[Payments] Failed to provision Supabase subscription:', subError.message);
      return Response.json({ error: 'Failed to provision subscription in the database.' }, { status: 500 });
    }

    // Keep Firestore updated for legacy parity during transition
    const batch = db.batch();
    batch.update(paymentRef, {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: admin.email || admin.uid,
    });
    batch.set(userRef, {
      plan: planConfig.id,
      proRuns: baseQuota + planConfig.proRuns,
      planUpdatedAt: new Date().toISOString(),
    }, { merge: true });

    await batch.commit();

    logSecurityEvent('PAYMENT_APPROVED', { uid: admin.uid, role: admin.role, email: admin.email || undefined }, {
      paymentId,
      uid: paymentData.uid,
      grantedPlan: planConfig.id,
      quotaAdded: planConfig.proRuns
    });

    return Response.json({ success: true, status: 'approved' });
  } catch (error) {
    return handleAuthError(error);
  }
}
