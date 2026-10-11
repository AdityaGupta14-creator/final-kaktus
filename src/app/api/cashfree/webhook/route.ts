import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminSupabase } from '@/lib/server/supabase';
import { db } from '@/lib/server/firebase-admin';
import { getPlanConfig } from '@/lib/server/plans';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-webhook-timestamp');

    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing webhook headers' }, { status: 400 });
    }

    const secret = process.env.CASHFREE_SECRET_KEY || '';
    const generatedSignature = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');

    if (generatedSignature !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    if (payload.type === 'PAYMENT_SUCCESS_WEBHOOK' && payload.data?.payment?.payment_status === 'SUCCESS') {
      const order = payload.data.order;
      const paymentId = order.order_id;
      const webhookAmount = order.order_amount;
      const webhookCurrency = order.order_currency;

      if (!paymentId) {
        return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
      }

      const paymentRef = db.collection('payments').doc(paymentId);
      
      // Step 1: Idempotency and Order Verification via Firestore Transaction
      let orderData;
      try {
        orderData = await db.runTransaction(async (t) => {
          const snap = await t.get(paymentRef);
          if (!snap.exists) {
            throw new Error('UNKNOWN_ORDER');
          }
          
          const data = snap.data();
          
          if (data?.status === 'approved') {
            return { status: 'already_approved' };
          }
          
          if (data?.status === 'processing_supabase') {
            return { status: 'processing_supabase', data };
          }

          if (data?.amount !== webhookAmount || data?.currency !== webhookCurrency) {
            throw new Error('AMOUNT_MISMATCH');
          }

          t.update(paymentRef, { status: 'processing_supabase' });
          return { status: 'ready', data };
        });
      } catch (err: any) {
        if (err.message === 'UNKNOWN_ORDER' || err.message === 'AMOUNT_MISMATCH') {
          console.error(`[Webhook] Rejected: ${err.message} for order ${paymentId}`);
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }

      if (orderData.status === 'already_approved') {
        return NextResponse.json({ success: true, note: 'Idempotent replay ignored' });
      }

      const { uid, planId } = orderData.data as any;
      const planConfig = getPlanConfig(planId);

      // Step 2: Supabase Provisioning (Partial Failure Recovery)
      const { data: existingSub } = await adminSupabase
        .from('subscriptions')
        .select('quota_remaining, metadata')
        .eq('user_uid', uid)
        .single();

      // If recovering from a partial failure, check if Supabase already processed THIS exact payment
      let skipSupabase = false;
      if (orderData.status === 'processing_supabase' && existingSub?.metadata?.last_payment_id === paymentId) {
        skipSupabase = true; // Supabase succeeded previously, but Firestore batch failed.
      }

      const userRef = db.collection('users').doc(uid);
      
      if (!skipSupabase) {
        const userSnap = await userRef.get();
        const currentProRuns = (userSnap.exists && userSnap.data()?.proRuns) ? Number(userSnap.data()?.proRuns) : 0;
        const baseQuota = existingSub ? existingSub.quota_remaining : currentProRuns;

        const expiresAt = new Date();
        if (planConfig.durationDays > 0) {
          expiresAt.setDate(expiresAt.getDate() + planConfig.durationDays);
        } else {
          expiresAt.setFullYear(expiresAt.getFullYear() + 100);
        }

        const { error: subError } = await adminSupabase.from('subscriptions').upsert({
          user_uid: uid,
          plan_id: planConfig.id,
          status: 'active',
          quota_remaining: baseQuota + planConfig.proRuns,
          expires_at: expiresAt.toISOString(),
          metadata: { last_payment_id: paymentId, updated_by: 'cashfree_webhook' }
        }, { onConflict: 'user_uid' });

        if (subError) {
          console.error('[Webhook] Failed to provision Supabase subscription:', subError.message);
          // Return 500 so Cashfree retries. State remains 'processing_supabase'.
          return NextResponse.json({ error: 'Failed to provision subscription in the database' }, { status: 500 });
        }
      }

      // Step 3: Complete Firestore Transaction
      const batch = db.batch();
      batch.update(paymentRef, {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'cashfree_webhook',
      });

      // Also update legacy user doc
      const userSnap = await userRef.get();
      const legacyProRuns = (userSnap.exists && userSnap.data()?.proRuns) ? Number(userSnap.data()?.proRuns) : 0;
      batch.set(userRef, {
        plan: planConfig.id,
        proRuns: legacyProRuns + planConfig.proRuns,
        planUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      await batch.commit();

      logSecurityEvent('PAYMENT_APPROVED', { uid: 'system', role: 'SYSTEM' }, {
        paymentId,
        uid: uid,
        grantedPlan: planConfig.id,
        quotaAdded: planConfig.proRuns
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Cashfree Webhook API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
