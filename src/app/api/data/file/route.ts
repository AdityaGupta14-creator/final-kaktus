import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { adminSupabase } from '@/lib/server/supabase';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    const { searchParams } = new URL(request.url);
    const bucket = searchParams.get('bucket');
    const path = searchParams.get('path');

    if (!bucket || !path) {
      return new Response('Missing parameters', { status: 400 });
    }

    if (!path.startsWith(`${uid}/`)) {
      return new Response('Unauthorized', { status: 403 });
    }

    // Explicitly verify the session ownership since the path format is uid/session_id/filename.ext
    const pathParts = path.split('/');
    if (pathParts.length !== 3) {
      return new Response('Invalid path format', { status: 400 });
    }
    const sessionId = pathParts[1];

    const { data: session } = await adminSupabase.from('chat_sessions').select('owner_uid').eq('id', sessionId).maybeSingle();
    if (!session || session.owner_uid !== uid) {
      return new Response('Unauthorized: Session not found or access denied', { status: 403 });
    }

    const { data, error } = await adminSupabase.storage.from(bucket).download(path);
    
    if (error || !data) {
      return new Response('File not found', { status: 404 });
    }

    return new Response(data, {
      headers: {
        'Content-Type': data.type,
      },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
