export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { db, auth } from '@/lib/server/firebase-admin';

export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');
    
    let query = adminSupabase
      .from('support_tickets')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);
      
    if (status) {
      query = query.eq('status', status);
    }
    
    if (assignedTo === 'me') {
      query = query.eq('assigned_to', user.uid);
    } else if (assignedTo === 'unassigned') {
      query = query.is('assigned_to', null);
    }

    const { data: tickets, error } = await query;

    if (error) {
      throw new Error(error.message);
    }
    
    // Fetch user details for all tickets
    const enrichedTickets = await Promise.all((tickets || []).map(async (t) => {
      let email = 'Unknown';
      try {
        const u = await auth.getUser(t.user_uid);
        email = u.email || 'Unknown';
      } catch (e) {}
      return { ...t, email };
    }));

    return Response.json({ success: true, tickets: enrichedTickets });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN', 'USER', 'FINANCE']);
    
    const body = await request.json();
    const { subject, category, priority, content } = body;
    
    if (!subject || !category || !content) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Insert ticket
    const { data: ticket, error: ticketError } = await adminSupabase
      .from('support_tickets')
      .insert({
        user_uid: user.uid,
        subject,
        category,
        priority: priority || 'Normal',
        status: 'Open'
      })
      .select('*')
      .single();
      
    if (ticketError) throw new Error(ticketError.message);
    
    // Insert initial message
    const { error: msgError } = await adminSupabase
      .from('support_messages')
      .insert({
        ticket_id: ticket.id,
        sender_uid: user.uid,
        is_internal: false,
        content
      });
      
    if (msgError) throw new Error(msgError.message);

    return Response.json({ success: true, ticket });
  } catch (error) {
    return handleAuthError(error);
  }
}
