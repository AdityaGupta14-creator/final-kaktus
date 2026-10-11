export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { logSecurityEvent } from '@/lib/server/security-logger';
import { auth, db } from '@/lib/server/firebase-admin';

export async function GET(request: Request) {
  try {
    await requireRole(request, ['SUPER_ADMIN']);
    
    // Fetch all members
    const { data: members, error } = await adminSupabase
      .from('early_access_members')
      .select('*')
      .order('granted_at', { ascending: false });

    if (error) {
      return Response.json({ error: 'Failed to fetch members' }, { status: 500 });
    }

    // Enrich with firebase emails
    const enrichedMembers = await Promise.all(
      (members || []).map(async (m) => {
        let email = 'Unknown';
        try {
          const userRecord = await auth.getUser(m.user_uid);
          email = userRecord.email || 'Unknown';
        } catch { }
        return {
          ...m,
          email
        };
      })
    );

    return Response.json({ members: enrichedMembers });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    const caller = await requireRole(request, ['SUPER_ADMIN']);
    const body = await request.json();
    const { action, uid, email } = body; // action: 'grant' | 'revoke'

    if (!uid) {
      return Response.json({ error: 'Missing UID' }, { status: 400 });
    }

    if (action === 'grant') {
      const { error } = await adminSupabase
        .from('early_access_members')
        .upsert({ user_uid: uid, granted_by: caller.uid });
        
      if (error) return Response.json({ error: 'Failed to grant access' }, { status: 500 });
      logSecurityEvent('EARLY_ACCESS_GRANTED', { uid: caller.uid }, { targetUid: uid, targetEmail: email });
    } else if (action === 'revoke') {
      const { error } = await adminSupabase
        .from('early_access_members')
        .delete()
        .eq('user_uid', uid);
        
      // Also delete from selected testers just in case
      await adminSupabase
        .from('early_access_feature_testers')
        .delete()
        .eq('user_uid', uid);
        
      if (error) return Response.json({ error: 'Failed to revoke access' }, { status: 500 });
      logSecurityEvent('EARLY_ACCESS_REVOKED', { uid: caller.uid }, { targetUid: uid, targetEmail: email });
    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
