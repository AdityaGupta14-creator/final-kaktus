export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { adminSupabase } from '@/lib/server/supabase';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(request: Request) {
  try {
    const admin = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE']);
    const body = await request.json();

    const { paymentId, reason } = body;
    if (!paymentId || !reason) {
      return Response.json({ error: 'paymentId and reason are required for refund.' }, { status: 400 });
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

    if (paymentData.status !== 'approved') {
      return Response.json({ error: 'Only approved payments can be refunded.' }, { status: 400 });
    }

    if (paymentData.refundedAt && paymentData.supabaseRevoked) {
      return Response.json({ error: 'Payment has already been fully refunded and revoked.' }, { status: 400 });
    }

    if (!paymentData.refundedAt) {
      await paymentRef.update({
        refundedAt: new Date().toISOString(),
        refundedBy: admin.email || admin.uid,
        refundReason: reason,
        supabaseRevoked: false,
      });
    }
    
    // Revoke subscription in Supabase
    const { data: existingSub } = await adminSupabase
      .from('subscriptions')
      .select('status, metadata')
      .eq('user_uid', paymentData.uid)
      .single();

    if (existingSub && existingSub.metadata?.last_payment_id === paymentId) {
       const { error: sbError } = await adminSupabase.from('subscriptions').update({
         status: 'canceled',
         metadata: { ...existingSub.metadata, canceled_reason: reason, canceled_by: admin.uid }
       }).eq('user_uid', paymentData.uid);
       
       if (sbError) {
         return Response.json({ error: 'Failed to revoke subscription in Supabase. Refund logged in Firestore. Please retry.', details: sbError.message }, { status: 500 });
       }
    }

    await paymentRef.update({ supabaseRevoked: true });

    logSecurityEvent('REFUND_ISSUED', { uid: admin.uid, role: admin.role, email: admin.email || undefined }, {
      paymentId,
      uid: paymentData.uid,
      reason,
    });
    
    return Response.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
