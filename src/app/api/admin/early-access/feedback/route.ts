export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { logSecurityEvent } from '@/lib/server/security-logger';
import { auth } from '@/lib/server/firebase-admin';

export async function GET(request: Request) {
  try {
    await requireRole(request, ['SUPER_ADMIN']);
    
    const { data: feedback, error } = await adminSupabase
      .from('early_access_feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return Response.json({ error: 'Failed to fetch feedback' }, { status: 500 });
    }

    // Enrich with firebase emails
    const enrichedFeedback = await Promise.all(
      (feedback || []).map(async (f) => {
        let email = 'Unknown';
        try {
          const userRecord = await auth.getUser(f.user_uid);
          email = userRecord.email || 'Unknown';
        } catch { }
        return {
          ...f,
          email
        };
      })
    );

    return Response.json({ feedback: enrichedFeedback });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    const caller = await requireRole(request, ['SUPER_ADMIN']);
    const body = await request.json();
    const { id, status, internal_notes } = body;

    if (!id) {
      return Response.json({ error: 'Feedback ID is required' }, { status: 400 });
    }

    const { error } = await adminSupabase
      .from('early_access_feedback')
      .update({ status, internal_notes })
      .eq('id', id);

    if (error) {
      return Response.json({ error: 'Failed to update feedback' }, { status: 500 });
    }

    logSecurityEvent('EARLY_ACCESS_FEEDBACK_UPDATED', { uid: caller.uid }, { feedbackId: id, status });
    return Response.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
