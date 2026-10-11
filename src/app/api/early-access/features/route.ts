export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    
    // Check if user is an early access member
    const { data: memberData } = await adminSupabase
      .from('early_access_members')
      .select('granted_at')
      .eq('user_uid', user.uid)
      .single();
      
    const isMember = !!memberData || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'EARLY_ACCESS';
    
    if (!isMember) {
      return Response.json({
        isMember: false,
        features: [],
        announcements: [],
        myFeedback: []
      });
    }

    // Fetch published features
    const { data: featuresData } = await adminSupabase
      .from('early_access_features')
      .select('*')
      .order('published_at', { ascending: false });

    // Fetch specific feature access for this user
    const { data: testersData } = await adminSupabase
      .from('early_access_feature_testers')
      .select('feature_slug')
      .eq('user_uid', user.uid);

    const userGrantedSlugs = new Set((testersData || []).map(t => t.feature_slug));

    // Process features to determine accessibility
    const processedFeatures = (featuresData || []).map(f => {
      let accessible = false;
      if (f.access_mode === 'all_members') accessible = true;
      if (f.access_mode === 'selected' && userGrantedSlugs.has(f.slug)) accessible = true;
      if (user.role === 'SUPER_ADMIN') accessible = true;
      
      return {
        ...f,
        accessible
      };
    });

    // Fetch user's feedback
    const { data: feedbackData } = await adminSupabase
      .from('early_access_feedback')
      .select('id, feature_slug, type, title, description, status, created_at')
      .eq('user_uid', user.uid)
      .order('created_at', { ascending: false });

    return Response.json({
      isMember: true,
      features: processedFeatures,
      myFeedback: feedbackData || []
    });

  } catch (error) {
    return handleAuthError(error);
  }
}
