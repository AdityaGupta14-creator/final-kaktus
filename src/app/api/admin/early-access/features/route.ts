export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function GET(request: Request) {
  try {
    await requireRole(request, ['SUPER_ADMIN']);
    
    const { data: features, error } = await adminSupabase
      .from('early_access_features')
      .select(`
        *,
        early_access_feature_testers(user_uid)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      return Response.json({ error: 'Failed to fetch features' }, { status: 500 });
    }

    return Response.json({ features: features || [] });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    const caller = await requireRole(request, ['SUPER_ADMIN']);
    const body = await request.json();
    const { 
      slug, title, description, category, release_version, 
      status, release_notes, testing_instructions, known_issues, 
      published_at, access_mode, testers 
    } = body;

    if (!slug || !title) {
      return Response.json({ error: 'Slug and title are required' }, { status: 400 });
    }

    // Upsert the feature
    const { error } = await adminSupabase
      .from('early_access_features')
      .upsert({
        slug, title, description, category, release_version,
        status, release_notes, testing_instructions, known_issues,
        published_at, access_mode
      });

    if (error) {
      return Response.json({ error: 'Failed to save feature' }, { status: 500 });
    }

    // Update selected testers if access_mode is 'selected'
    if (access_mode === 'selected' && Array.isArray(testers)) {
      await adminSupabase
        .from('early_access_feature_testers')
        .delete()
        .eq('feature_slug', slug);

      if (testers.length > 0) {
        await adminSupabase
          .from('early_access_feature_testers')
          .insert(testers.map(uid => ({ feature_slug: slug, user_uid: uid })));
      }
    } else if (access_mode !== 'selected') {
       // Clear testers if mode changed
       await adminSupabase
        .from('early_access_feature_testers')
        .delete()
        .eq('feature_slug', slug);
    }

    logSecurityEvent('EARLY_ACCESS_FEATURE_UPDATED', { uid: caller.uid }, { featureSlug: slug });
    return Response.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
