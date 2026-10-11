export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    // 1. Fetch Firebase Profile Data
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    
    // 1b. Fetch authoritative subscription from Supabase
    let subscription = null;
    try {
      const { data: subData } = await adminSupabase
        .from('subscriptions')
        .select('*')
        .eq('user_uid', uid)
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
      console.warn('[Profile API] Failed to fetch subscription:', e);
    }
    
    const profile = {
      uid,
      email: user.email,
      name: (user.claims?.name as string) || userData.displayName || user.email,
      picture: (user.claims?.picture as string) || userData.photoURL || null,
      createdAt: user.claims?.auth_time ? new Date((user.claims.auth_time as number) * 1000).toISOString() : null,
      role: user.role || 'USER',
      status: userData.status || 'active',
      plan: subscription?.planId || userData.plan || 'free',
      subscription,
      isEarlyAccessMember: false
    };

    try {
      const { data: memberData } = await adminSupabase
        .from('early_access_members')
        .select('user_uid')
        .eq('user_uid', uid)
        .single();
      if (memberData || user.role === 'SUPER_ADMIN') {
        profile.isEarlyAccessMember = true;
      }
    } catch (e) {
      console.warn('[Profile API] Failed to check early access:', e);
    }

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
        .eq('user_uid', uid)
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
      console.warn(`[Profile API] API Usage error for ${uid}:`, e);
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
        .eq('owner_uid', uid)
        .order('updated_at', { ascending: false });

      if (projectsError) {
        projectsErrorMsg = 'Failed to connect to Supabase';
        console.warn('[Profile API] Failed to fetch projects:', projectsError);
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
        .eq('owner_uid', uid)
        .order('updated_at', { ascending: false });

      if (chatsError) {
        chatsErrorMsg = 'Failed to connect to Supabase';
        console.warn('[Profile API] Failed to fetch chats:', chatsError);
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
