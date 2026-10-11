export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);
    
    const { data: tickets, error } = await adminSupabase
      .from('support_tickets')
      .select('*');

    if (error) {
      throw new Error(error.message);
    }
    
    const totalOpen = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress' || t.status === 'Waiting for User').length;
    const unassigned = tickets.filter(t => !t.assigned_to && t.status !== 'Resolved' && t.status !== 'Closed').length;
    const highPriority = tickets.filter(t => (t.priority === 'High' || t.priority === 'Urgent') && t.status !== 'Resolved' && t.status !== 'Closed').length;
    const waitingForUser = tickets.filter(t => t.status === 'Waiting for User').length;
    const resolved = tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length;

    return Response.json({ 
      success: true, 
      metrics: {
        totalOpen,
        unassigned,
        highPriority,
        waitingForUser,
        resolved
      }
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
