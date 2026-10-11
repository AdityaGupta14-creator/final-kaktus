export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { auth, db } from '@/lib/server/firebase-admin';

export async function GET(request: Request) {
  try {
    const caller = await requireRole(request, ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SUPPORT']);

    // List users from Firebase Auth
    const listUsersResult = await auth.listUsers(1000);
    const authUsers = listUsersResult.users;

    // Fetch Firestore users to get legacy plan IDs and project counts
    const profilesSnap = await db.collection('users').get();
    const profiles = new Map();
    profilesSnap.forEach(doc => profiles.set(doc.id, doc.data()));

    // Fetch authoritative Subscriptions from Supabase
    const { adminSupabase } = await import('@/lib/server/supabase');
    const { data: subsData, error: subsError } = await adminSupabase
      .from('subscriptions')
      .select('user_uid, plan_id, status, quota_remaining, expires_at');
    
    if (subsError) {
      console.warn('[Admin API] Failed to fetch Supabase subscriptions:', subsError);
    }
    
    const subscriptions = new Map();
    if (subsData) {
      subsData.forEach(sub => subscriptions.set(sub.user_uid, sub));
    }

    const users = authUsers.map(record => {
      const profile = profiles.get(record.uid) || {};
      const claims = record.customClaims || {};
      const role = claims.role || profile.role || 'USER';
      const sub = subscriptions.get(record.uid);

      // Prefer Supabase subscription, fallback to Firestore legacy plan
      const authoritativePlanId = sub?.plan_id || profile.plan || 'free';

      return {
        uid: record.uid,
        email: record.email || null,
        displayName: record.displayName || profile.displayName || null,
        role,
        planId: authoritativePlanId,
        accountStatus: record.disabled ? 'suspended' : 'active',
        createdAt: record.metadata.creationTime,
        lastLoginAt: record.metadata.lastSignInTime,
        projectCount: profile.projectCount || 0,
        // Include authoritative subscription details for the admin UI
        subscription: sub ? {
          status: sub.status,
          quotaRemaining: sub.quota_remaining,
          expiresAt: sub.expires_at,
        } : null
      };
    });

    return Response.json({ users });
  } catch (error) {
    return handleAuthError(error);
  }
}
