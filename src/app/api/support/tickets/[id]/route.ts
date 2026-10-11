export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { auth } from '@/lib/server/firebase-admin';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN', 'USER', 'FINANCE']);
    const params = await props.params;
    const ticketId = params.id;
    
    // Fetch ticket
    const { data: ticket, error: ticketError } = await adminSupabase
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .single();
      
    if (ticketError || !ticket) {
      return Response.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const isStaff = ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'].includes(user.role as string);

    if (!isStaff && ticket.user_uid !== user.uid) {
      return Response.json({ error: 'Unauthorized to view this ticket' }, { status: 403 });
    }
    
    let email = 'Unknown';
    try {
      const u = await auth.getUser(ticket.user_uid);
      email = u.email || 'Unknown';
    } catch (e) {}
    
    // Fetch messages
    const { data: messages, error: messagesError } = await adminSupabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
      
    if (messagesError) throw new Error(messagesError.message);

    let filteredMessages = messages || [];
    if (!isStaff) {
      filteredMessages = filteredMessages.filter((m: any) => !m.is_internal);
    }
    
    const enrichedMessages = await Promise.all(filteredMessages.map(async (m: any) => {
      let senderEmail = 'Unknown';
      try {
        const u = await auth.getUser(m.sender_uid);
        senderEmail = u.email || 'Unknown';
      } catch (e) {}
      return { ...m, sender_email: senderEmail };
    }));

    return Response.json({ success: true, ticket: { ...ticket, email }, messages: enrichedMessages });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);
    const params = await props.params;
    const ticketId = params.id;
    
    const body = await request.json();
    const updates: any = {};
    
    if (body.status) updates.status = body.status;
    if (body.priority) updates.priority = body.priority;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
    if (body.escalated_to !== undefined) updates.escalated_to = body.escalated_to;
    if (body.escalation_reason !== undefined) updates.escalation_reason = body.escalation_reason;
    
    if (body.status === 'Resolved' || body.status === 'Closed') {
      updates.resolved_at = new Date().toISOString();
    }
    
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    const { data: ticket, error: ticketError } = await adminSupabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticketId)
      .select('*')
      .single();
      
    if (ticketError) throw new Error(ticketError.message);
    
    return Response.json({ success: true, ticket });
  } catch (error) {
    return handleAuthError(error);
  }
}
