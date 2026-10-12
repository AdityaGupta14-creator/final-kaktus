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
      .select('id, name, workspace_state, updated_at')
      .eq('owner_uid', uid)
      .order('updated_at', { ascending: false });

    if (projectsData) {
      projectsData.forEach(p => {
        if (p.workspace_state) {
          workspaces[p.id] = typeof p.workspace_state === 'string' ? p.workspace_state : JSON.stringify(p.workspace_state);
        }
      });
    }

    // 2. Fetch chat sessions and messages
    const { data: sessionsData } = await adminSupabase
      .from('chat_sessions')
      .select('id, title, updated_at')
      .eq('owner_uid', uid)
      .order('updated_at', { ascending: false });

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
          if (grouped[msg.session_id]) {
            const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
            let cleanText = meta.cleanText;
            if (!cleanText && typeof msg.content === 'string') {
              if (msg.message_role === 'user') {
                cleanText = msg.content;
              } else {
                cleanText = msg.content.replace(/<tutorial>[\s\S]*?<\/tutorial>/gi, '').replace(/<cmd[\s>][\s\S]*?<\/cmd>/gi, '').trim();
                if (!cleanText) cleanText = 'Updated the circuit design.';
              }
            }
            grouped[msg.session_id].push({
              id: msg.id,
              role: msg.message_role,
              content: msg.content,
              cleanText: cleanText || msg.content,
              createdAt: meta.createdAt || (msg.created_at ? new Date(msg.created_at).getTime() : Date.now()),
              commands: meta.commands,
              tutorialData: meta.tutorialData,
              workActions: meta.workActions,
              workTimeMs: meta.workTimeMs,
              optionsBlock: meta.optionsBlock,
              nextStepsBlock: meta.nextStepsBlock,
              sources: meta.sources,
              phasePlan: meta.phasePlan,
              phaseIndex: meta.phaseIndex,
              imageAttachments: meta.imageAttachments || undefined,
              metadata: meta
            });
          }
        });

        Object.keys(grouped).forEach(id => {
          chats[id] = JSON.stringify(grouped[id]);
        });
      }
      
      // Construct a registry for the client from Supabase sessions
      registry = {
        version: 1,
        activeId: sessionIds[0],
        sessions: sessionsData.map(s => ({
          id: s.id,
          title: s.title || 'Saved Chat',
          updatedAt: s.updated_at ? new Date(s.updated_at).getTime() : Date.now()
        }))
      };
    } else if (projectsData && projectsData.length > 0) {
      // Fallback: If sessions are empty but projects exist in Supabase
      registry = {
        version: 1,
        activeId: projectsData[0].id,
        sessions: projectsData.map(p => ({
          id: p.id,
          title: p.name || 'Saved Project',
          updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : Date.now()
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
