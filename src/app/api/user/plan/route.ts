export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { getPlanConfig } from '@/lib/server/plans';
import { adminSupabase } from '@/lib/server/supabase';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const planId = (body.plan || 'free').toLowerCase();
    const planConfig = getPlanConfig(planId);

    const expiresAt = new Date();
    if (planConfig.id !== 'free') {
      expiresAt.setDate(expiresAt.getDate() + (planConfig.durationDays || 7));
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 100);
    }

    // Update Firestore user document
    const userRef = db.collection('users').doc(user.uid);
    await userRef.set({
      plan: planConfig.id,
      planExpiresAt: expiresAt.toISOString(),
      planUpdatedAt: new Date().toISOString(),
    }, { merge: true });

    // Optionally update Supabase subscription
    try {
      await adminSupabase.from('subscriptions').upsert({
        user_uid: user.uid,
        plan_id: planConfig.id,
        status: 'active',
        quota_remaining: planConfig.proRuns,
        expires_at: expiresAt.toISOString(),
        metadata: { updated_by: 'instant_plan_route' }
      }, { onConflict: 'user_uid' });
    } catch (err) {
      console.warn('[Plan Route] Supabase subscription update skipped/failed:', err);
    }

    return Response.json({
      success: true,
      plan: planConfig.id,
      expiresAt: expiresAt.toISOString(),
      message: `Plan updated to ${planConfig.name} (${planConfig.durationDays} days validity)`
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
