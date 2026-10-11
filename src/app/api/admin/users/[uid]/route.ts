export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { db, auth } from '@/lib/server/firebase-admin';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request, props: { params: Promise<{ uid: string }> }) {
  try {
    // Stage 2 requirement: Only SUPER_ADMIN can inspect arbitrary users
    await requireRole(request, ['SUPER_ADMIN']);
    const params = await props.params;
    const targetUid = params.uid;

    if (!targetUid) {
      return Response.json({ error: 'Target UID is required' }, { status: 400 });
    }

    // 1. Fetch Auth & Firestore Profile Data
    let authRecord;
    try {
      authRecord = await auth.getUser(targetUid);
    } catch (e) {
      return Response.json({ error: 'User not found in Firebase Auth' }, { status: 404 });
    }

    const userRef = db.collection('users').doc(targetUid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    
    // Fetch authoritative subscription from Supabase
    let subscription = null;
    try {
      const { data: subData } = await adminSupabase
        .from('subscriptions')
        .select('*')
        .eq('user_uid', targetUid)
        .single();
        
      if (subData) {
        subscription = {
          planId: subData.plan_id,
          status: subData.status,
          quotaRemaining: subData.quota_remaining,
          expiresAt: subData.expires_at,
          createdAt: subData.created_at
        };
      }
    } catch (e) {
      console.warn('[Admin User Inspection] Failed to fetch subscription:', e);
    }
    
    const profile = {
      uid: targetUid,
      email: authRecord.email,
      name: authRecord.displayName || userData.displayName || authRecord.email,
      picture: authRecord.photoURL || userData.photoURL || null,
      createdAt: authRecord.metadata.creationTime ? new Date(authRecord.metadata.creationTime).toISOString() : null,
      lastSignInTime: authRecord.metadata.lastSignInTime ? new Date(authRecord.metadata.lastSignInTime).toISOString() : null,
      role: authRecord.customClaims?.role || 'USER',
      status: userData.status || 'active',
      plan: subscription?.planId || userData.plan || 'free',
      subscription
    };

    // 2. Fetch API Usage from Supabase
    let usageErrorMsg = null;
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalTokens = 0;
    const modelBreakdown: Record<string, number> = {};
    let usageHistory: any[] = [];

    try {
      const { data: usageData, error: sbUsageError } = await adminSupabase
        .from('api_usage')
        .select('*')
        .eq('user_uid', targetUid)
        .order('created_at', { ascending: false })
        .limit(100);

      if (sbUsageError) {
        throw new Error(sbUsageError.message);
      }

      usageHistory = (usageData || []).map((row: any) => {
        totalRequests++;
        if (row.success) successfulRequests++;
        else failedRequests++;
        
        if (row.total_tokens) totalTokens += row.total_tokens;
        
        if (row.model) {
          modelBreakdown[row.model] = (modelBreakdown[row.model] || 0) + 1;
        }
        
        return {
          id: row.id,
          model: row.model,
          success: row.success,
          durationMs: row.duration_ms,
          tokens: row.total_tokens,
          createdAt: row.created_at
        };
      });
    } catch (e: any) {
      usageErrorMsg = e.message || 'Failed to fetch usage history';
      console.warn(`[Admin User Inspection] API Usage error for ${targetUid}:`, e);
    }

    const usage = {
      totalRequests,
      successfulRequests,
      failedRequests,
      totalTokens,
      modelBreakdown,
      history: usageHistory
    };

    // 3. Fetch Projects from Supabase
    let projects: any[] = [];
    let projectsErrorMsg = null;
    try {
      const { data: projectsData, error: projectsError } = await adminSupabase
        .from('projects')
        .select('id, name, updated_at')
        .eq('owner_uid', targetUid)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (projectsError) {
        projectsErrorMsg = 'Failed to connect to Supabase';
        console.warn(`[Admin User Inspection] Projects error for ${targetUid}:`, projectsError);
      } else {
        projects = (projectsData || []).map(p => ({
          id: p.id,
          name: p.name || 'Untitled Project',
          updatedAt: p.updated_at
        }));
      }
    } catch (e) {
      projectsErrorMsg = 'Supabase unavailable';
    }

    // 4. Fetch Chats from Supabase
    let chats: any[] = [];
    let chatsErrorMsg = null;
    try {
      const { data: chatsData, error: chatsError } = await adminSupabase
        .from('chat_sessions')
        .select('id, title, updated_at')
        .eq('owner_uid', targetUid)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (chatsError) {
        chatsErrorMsg = 'Failed to connect to Supabase';
        console.warn(`[Admin User Inspection] Chats error for ${targetUid}:`, chatsError);
      } else {
        chats = (chatsData || []).map(c => ({
          id: c.id,
          title: c.title || 'Saved Chat',
          updatedAt: c.updated_at
        }));
      }
    } catch (e) {
      chatsErrorMsg = 'Supabase unavailable';
    }

    return Response.json({
      success: true,
      profile,
      usage,
      usageError: usageErrorMsg,
      projects,
      projectsError: projectsErrorMsg,
      chats,
      chatsError: chatsErrorMsg
    });

  } catch (error) {
    return handleAuthError(error);
  }
}
