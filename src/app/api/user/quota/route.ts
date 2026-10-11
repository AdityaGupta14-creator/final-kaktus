export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { db } from '@/lib/server/firebase-admin';
import { getPlanConfig } from '@/lib/server/plans';

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    let planId = 'free';
    let quotaRemaining = 0;
    let expiresAt = null;

    // 1. Check Supabase for active subscription (authoritative for runs/expiry)
    const { data: subData, error } = await adminSupabase
      .from('subscriptions')
      .select('plan_id, quota_remaining, expires_at, status')
      .eq('user_uid', uid)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Supabase query failed: ${error.message}`);
    }

    if (subData && subData.status === 'active' && (!subData.expires_at || new Date(subData.expires_at) > new Date())) {
      planId = subData.plan_id;
      quotaRemaining = subData.quota_remaining;
      expiresAt = subData.expires_at;
    } else {
      // 2. Fallback to Firebase legacy user doc if no Supabase sub exists
      const userRef = db.collection('users').doc(uid);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        const data = userSnap.data();
        planId = data?.plan || 'free';
        quotaRemaining = data?.proRuns ? Number(data.proRuns) : 0;
      }
    }

    const planConfig = getPlanConfig(planId);

    // Kaktus tracks quota in "Runs" (1 per request), not "Tokens".
    // We return the runs here to keep the UI honest.
    return Response.json({
      success: true,
      quota: {
        planId,
        runsRemaining: Math.max(0, quotaRemaining),
        planMaxRuns: planConfig.proRuns,
        expiresAt
      }
    });

  } catch (error) {
    return handleAuthError(error);
  }
}
