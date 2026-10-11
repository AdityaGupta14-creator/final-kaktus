export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    
    // Check if user is an early access member
    const { data: memberData } = await adminSupabase
      .from('early_access_members')
      .select('granted_at')
      .eq('user_uid', user.uid)
      .single();
      
    if (!memberData && user.role !== 'SUPER_ADMIN') {
      return Response.json({ error: 'Not an early access member' }, { status: 403 });
    }

    const body = await request.json();
    const { featureSlug, type, title, description, reproductionSteps, severity } = body;

    if (!title || !description || !type) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('early_access_feedback')
      .insert({
        user_uid: user.uid,
        feature_slug: featureSlug || null,
        type,
        title,
        description,
        reproduction_steps: reproductionSteps || null,
        severity: severity || null,
        status: 'new'
      })
      .select()
      .single();

    if (error) {
      console.error('[Early Access Feedback Error]', error);
      return Response.json({ error: 'Failed to submit feedback' }, { status: 500 });
    }

    logSecurityEvent('EARLY_ACCESS_FEEDBACK_SUBMITTED', { uid: user.uid }, { feedbackId: data.id });

    return Response.json({ success: true, feedback: data });

  } catch (error) {
    return handleAuthError(error);
  }
}
