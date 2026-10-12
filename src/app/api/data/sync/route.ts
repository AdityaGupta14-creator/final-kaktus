export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;
  return Buffer.from(matches[2], 'base64');
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { registry, workspaces, chats } = body;

    // 1. Create or update profile in Supabase to ensure foreign key validity
    const { error: profileError } = await adminSupabase
      .from('profiles')
      .upsert({
        uid,
        email: user.email || null,
        display_name: (user.claims?.name as string) || user.email?.split('@')[0] || 'User',
        avatar_url: (user.claims?.picture as string) || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'uid' });

    if (profileError) {
      console.error('[Supabase] Profile upsert error:', profileError);
    }

    // Parse registry sessions list for titles if available
    let registrySessions: any[] = [];
    if (registry) {
      try {
        const parsedReg = typeof registry === 'string' ? JSON.parse(registry) : registry;
        if (Array.isArray(parsedReg?.sessions)) {
          registrySessions = parsedReg.sessions;
        }
      } catch { /* ignore invalid registry format */ }
    }

    // 2. Save Workspaces (Projects)
    if (workspaces && typeof workspaces === 'object') {
      for (const [id, payload] of Object.entries(workspaces)) {
        let workspaceState: any = payload;
        if (typeof payload === 'string') {
          try {
            workspaceState = JSON.parse(payload);
          } catch {
            workspaceState = {};
          }
        }
        
        const compsToInsert: any[] = [];
        const connsToInsert: any[] = [];
        const filesToInsert: any[] = [];

        if (workspaceState && Array.isArray(workspaceState.tabs)) {
          workspaceState.tabs.forEach((tab: any) => {
            const compMap = new Map();
            const wireMap = new Map();
            let codeContent = '';
            let codeLang = '';

            if (tab.data && Array.isArray(tab.data.steps)) {
               tab.data.steps.forEach((step: any) => {
                   if (step.remove_components) step.remove_components.forEach((cid: string) => { compMap.delete(cid); for (const [k, w] of Array.from(wireMap.entries())) { if (w.from.startsWith(cid+':') || w.to.startsWith(cid+':')) wireMap.delete(k); } });
                   if (step.remove_wiring) step.remove_wiring.forEach((w: any) => {
                       if (typeof w === 'string') {
                          for (const [k, wire] of Array.from(wireMap.entries())) {
                             if (wire.from === w || wire.to === w) wireMap.delete(k);
                          }
                       } else if (w && w.from && w.to) {
                          wireMap.delete(`${w.from}-${w.to}`);
                       }
                   });
                   if (step.add_components) step.add_components.forEach((c: any) => compMap.set(c.id, c));
                   if (step.add_wiring) step.add_wiring.forEach((w: any) => wireMap.set(`${w.from}-${w.to}`, w));
                   if (step.code) {
                       codeContent = step.code;
                       codeLang = step.code_language || 'cpp';
                   }
               });
            }

            compMap.forEach(comp => {
                compsToInsert.push({
                    id: `${id}-${comp.id}`,
                    component_type: comp.type,
                    configuration: comp,
                    placement: { x: comp.x, y: comp.y }
                });
            });

            wireMap.forEach(wire => {
                const [source_comp, source_pin] = wire.from.split(':');
                const [target_comp, target_pin] = wire.to.split(':');
                connsToInsert.push({
                    id: `${id}-${wire.from}-${wire.to}`,
                    source_component_id: `${id}-${source_comp}`,
                    source_pin: source_pin || wire.from,
                    target_component_id: `${id}-${target_comp}`,
                    target_pin: target_pin || wire.to,
                    metadata: { color: wire.color }
                });
            });

            if (codeContent) {
               filesToInsert.push({
                   id: `${id}-${tab.id}-code`,
                   filename: `main.${codeLang === 'cpp' ? 'cpp' : 'ino'}`,
                   file_type: 'code',
                   content: codeContent
               });
            }

            if (tab.data && tab.data.blueprint_svg) {
               filesToInsert.push({
                   id: `${id}-${tab.id}-blueprint`,
                   filename: `${tab.name || 'blueprint'}.svg`,
                   file_type: 'svg',
                   content: tab.data.blueprint_svg
               });
            }
          });
        }

        const uniqueCompsToInsert = Array.from(new Map(compsToInsert.map(c => [c.id, c])).values());
        const uniqueConnsToInsert = Array.from(new Map(connsToInsert.map(c => [c.id, c])).values());

        const compIds = new Set(uniqueCompsToInsert.map(c => c.id));
        const validConns = uniqueConnsToInsert.filter(c => compIds.has(c.source_component_id) && compIds.has(c.target_component_id));

        // Derive descriptive project name
        const matchingSession = registrySessions.find((s: any) => s.id === id);
        const derivedProjectName = (matchingSession?.title && matchingSession.title !== 'New chat')
          ? matchingSession.title
          : (workspaceState?.projectName || workspaceState?.name || (workspaceState?.tabs?.[0]?.name && workspaceState.tabs[0].name !== 'Main Assembly' ? workspaceState.tabs[0].name : `Project ${id.substring(0, 8)}`));

        // Use RPC for atomic sync to prevent partial data loss and ensure authorization.
        const { error: rpcError } = await adminSupabase.rpc('sync_workspace_atomic', {
          p_owner_uid: uid,
          p_project_id: id,
          p_project_name: derivedProjectName,
          p_workspace_state: workspaceState,
          p_components: uniqueCompsToInsert,
          p_connections: validConns,
          p_files: filesToInsert
        });

        if (rpcError) {
          console.error(`[Supabase] Workspace atomic sync error for ${id}:`, rpcError);
          if (rpcError.message.includes('Unauthorized')) {
            return new Response('Unauthorized project modification', { status: 403 });
          }
          return Response.json({ success: false, error: 'Failed to sync workspace' }, { status: 500 });
        }
        
        // Log workspace sync activity
        await adminSupabase.from('activity_logs').insert({
          id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          user_uid: uid,
          event_type: 'PROJECT_SYNCED',
          resource_id: id,
          metadata: { components: compsToInsert.length, files: filesToInsert.length }
        });
      }
    }

    // 3. Save Chats
    if (chats && typeof chats === 'object') {
      for (const [id, payload] of Object.entries(chats)) {
        let chatData: any = payload;
        if (typeof payload === 'string') {
          try {
            chatData = JSON.parse(payload);
          } catch {
            chatData = [];
          }
        }
        
        const messagesToInsert = [];
        if (Array.isArray(chatData)) {
          for (let index = 0; index < chatData.length; index++) {
            const msg = chatData[index];
            const metadata: Record<string, any> = {
              cleanText: msg.cleanText,
              createdAt: msg.createdAt,
              commands: msg.commands,
              tutorialData: msg.tutorialData,
              workActions: msg.workActions,
              workTimeMs: msg.workTimeMs,
              optionsBlock: msg.optionsBlock,
              nextStepsBlock: msg.nextStepsBlock,
              sources: msg.sources,
              phasePlan: msg.phasePlan,
              phaseIndex: msg.phaseIndex,
              ...(msg.metadata || {})
            };

            // Upload binary attachments before touching the database
            if (msg.imageAttachments && Array.isArray(msg.imageAttachments)) {
               const processedAttachments = [];
               for (let i = 0; i < msg.imageAttachments.length; i++) {
                 const att = msg.imageAttachments[i];
                 // Data is raw base64 without the data: prefix
                 if (att.data && typeof att.data === 'string' && !att.url) {
                   const buffer = Buffer.from(att.data, 'base64');
                   if (buffer) {
                     const mimeType = att.mimeType || 'image/png';
                     const ext = mimeType.split('/')[1] || 'png';
                     const fileName = `${uid}/${id}/${index}-${i}.${ext}`;
                     
                     // Supabase Storage upload
                     const { error: uploadErr } = await adminSupabase.storage
                       .from('chat_attachments')
                       .upload(fileName, buffer, {
                         contentType: mimeType,
                         upsert: true
                       });
                     
                     if (uploadErr) {
                       console.error(`[Supabase] Upload error for ${fileName}:`, uploadErr);
                       return Response.json({ success: false, error: 'Failed to upload attachments' }, { status: 500 });
                     }
                       
                     const proxyUrl = `/api/data/file?bucket=chat_attachments&path=${encodeURIComponent(fileName)}`;
                     
                     // Log file upload
                     await adminSupabase.from('activity_logs').insert({
                        id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        user_uid: uid,
                        event_type: 'FILE_UPLOADED',
                        resource_id: id,
                        metadata: { fileName, mimeType }
                     });
                     
                     processedAttachments.push({
                        id: att.id,
                        name: att.name,
                        mimeType,
                        storagePath: fileName,
                        url: proxyUrl
                     });
                   }
                 } else {
                   processedAttachments.push(att);
                 }
               }
               metadata.imageAttachments = processedAttachments;
            }

            messagesToInsert.push({
              id: `${id}-msg-${index}`,
              message_role: msg.role || 'user',
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
              metadata: metadata
            });
          }
        }

        const matchingChatSession = registrySessions.find((s: any) => s.id === id);
        const derivedChatTitle = matchingChatSession?.title || 'Saved Chat';

        // Use RPC for atomic sync to prevent partial data loss and ensure authorization.
        const { error: rpcError } = await adminSupabase.rpc('sync_chat_atomic', {
          p_owner_uid: uid,
          p_session_id: id,
          p_title: derivedChatTitle,
          p_messages: messagesToInsert
        });

        if (rpcError) {
          console.error(`[Supabase] Chat atomic sync error for ${id}:`, rpcError);
          if (rpcError.message.includes('Unauthorized')) {
            return new Response('Unauthorized chat modification', { status: 403 });
          }
          return Response.json({ success: false, error: 'Failed to sync chat' }, { status: 500 });
        }
        
        // Log chat sync activity
        await adminSupabase.from('activity_logs').insert({
          id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          user_uid: uid,
          event_type: 'CHAT_SYNCED',
          resource_id: id,
          metadata: { messageCount: messagesToInsert.length }
        });
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
