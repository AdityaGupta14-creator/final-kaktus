export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { adminSupabase } from '@/lib/server/supabase';
import { PLANS } from '@/lib/server/plans';

export async function GET(request: Request) {
  try {
    await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE']);

    // 1. Fetch payments
    const paymentsSnap = await db.collection('payments').orderBy('createdAt', 'desc').get();
    const payments = paymentsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: data.uid || '',
        email: data.email || null,
        planId: data.planId || '',
        txnId: data.txnId || '',
        status: data.status || 'pending',
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null,
        reviewedAt: data.reviewedAt || null,
        reviewedBy: data.reviewedBy || null,
        refundedAt: data.refundedAt || null,
      };
    });

    // 2. Fetch Subscriptions
    const { data: subscriptionsData, error: subError } = await adminSupabase
      .from('subscriptions')
      .select('*')
      .order('created_at', { ascending: false });

    if (subError) {
      console.error('[Finance] Error fetching subscriptions:', subError);
    }

    // 3. Fetch Finance Audit Logs
    // Note: Removed orderBy('timestamp') to avoid requiring a composite index. Sorting manually.
    const auditSnap = await db.collection('security-logs')
      .where('type', 'in', ['PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'REFUND_ISSUED', 'QUOTA_ADJUSTED'])
      .get();
      
    let auditLogs = auditSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    auditLogs.sort((a: any, b: any) => {
      const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime();
      const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    });
    auditLogs = auditLogs.slice(0, 100);

    // Calculate Overview Metrics
    let totalRevenue = 0;
    let pendingRequests = 0;
    let pendingAmount = 0;
    let activeSubs = 0;
    let expiredSubs = 0;
    let approvedTx = 0;
    let rejectedTx = 0;
    let refundedTx = 0;

    const now = new Date();

    payments.forEach(p => {
      const plan = PLANS[p.planId];
      const price = plan ? plan.price : 0;
      
      if (p.status === 'approved') {
        approvedTx++;
        if (!p.refundedAt) {
          totalRevenue += price;
        } else {
          refundedTx++;
        }
      } else if (p.status === 'rejected') {
        rejectedTx++;
      } else if (p.status === 'pending') {
        pendingRequests++;
        pendingAmount += price;
      }
    });

    subscriptionsData?.forEach(s => {
      if (s.status === 'active') {
        if (s.expires_at && new Date(s.expires_at) < now) {
          expiredSubs++;
        } else {
          activeSubs++;
        }
      }
    });

    return Response.json({
      payments,
      subscriptions: subscriptionsData || [],
      auditLogs,
      overview: {
        totalRevenue,
        pendingRequests,
        pendingAmount,
        activeSubs,
        expiredSubs,
        approvedTx,
        rejectedTx,
        refundedTx,
      }
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
