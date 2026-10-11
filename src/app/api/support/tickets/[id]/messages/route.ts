export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);
    const params = await props.params;
    const ticketId = params.id;
    
    const body = await request.json();
    const { content, is_internal } = body;
    
    if (!content) {
      return Response.json({ error: 'Message content is required' }, { status: 400 });
    }

    const { data: message, error: messageError } = await adminSupabase
      .from('support_messages')
      .insert({
        ticket_id: ticketId,
        sender_uid: user.uid,
        is_internal: !!is_internal,
        content
      })
      .select('*')
      .single();
      
    if (messageError) throw new Error(messageError.message);
    
    // Update ticket updated_at
    await adminSupabase
      .from('support_tickets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', ticketId);
    
    return Response.json({ success: true, message });
  } catch (error) {
    return handleAuthError(error);
  }
}
