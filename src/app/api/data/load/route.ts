export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    const workspaces: Record<string, string> = {};
    const chats: Record<string, string> = {};
    let registry = null;

    // 1. Fetch projects (workspaces)
    const { data: projectsData } = await adminSupabase
      .from('projects')
      .select('id, workspace_state')
      .eq('owner_uid', uid);

    if (projectsData) {
      projectsData.forEach(p => {
        workspaces[p.id] = JSON.stringify(p.workspace_state);
      });
    }

    // 2. Fetch chat sessions and messages
    const { data: sessionsData } = await adminSupabase
      .from('chat_sessions')
      .select('id')
      .eq('owner_uid', uid);

    if (sessionsData && sessionsData.length > 0) {
      const sessionIds = sessionsData.map(s => s.id);
      const { data: messagesData } = await adminSupabase
        .from('chat_messages')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });

      if (messagesData) {
        // Group messages by session
        const grouped: Record<string, any[]> = {};
        sessionIds.forEach(id => grouped[id] = []);
        
        messagesData.forEach(msg => {
          grouped[msg.session_id].push({
            role: msg.message_role,
            content: msg.content,
            metadata: msg.metadata,
            imageAttachments: msg.metadata?.imageAttachments || undefined
          });
        });

        Object.keys(grouped).forEach(id => {
          chats[id] = JSON.stringify(grouped[id]);
        });
      }
      
      // Construct a mock registry for the client
      registry = {
        version: 1,
        activeId: sessionIds[0],
        sessions: sessionsData.map(s => ({
          id: s.id,
          title: 'Saved Chat',
          updatedAt: Date.now()
        }))
      };
    }

    return Response.json({
      success: true,
      data: {
        registry: registry ? JSON.stringify(registry) : null,
        workspaces,
        chats
      }
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
