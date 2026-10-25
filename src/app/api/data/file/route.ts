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
    if (!['project_files', 'chat_attachments'].includes(bucket)) {
      return new Response('Invalid bucket', { status: 400 });
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
    const filename = pathParts[2];
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !/^[A-Za-z0-9._-]{1,180}$/.test(filename) || filename === '.' || filename === '..') {
      return new Response('Invalid file path', { status: 400 });
    }

    const { data: session } = await adminSupabase.from('chat_sessions').select('owner_uid').eq('id', sessionId).maybeSingle();
    if (!session || session.owner_uid !== uid) {
      return new Response('Unauthorized: Session not found or access denied', { status: 403 });
    }

    const { data, error } = await adminSupabase.storage.from(bucket).download(path);
    
    if (error || !data) {
      return new Response('File not found', { status: 404 });
    }

    const safeInlineTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    const contentType = safeInlineTypes.has(data.type.toLowerCase()) ? data.type.toLowerCase() : 'application/octet-stream';
    const disposition = safeInlineTypes.has(data.type.toLowerCase())
      ? `inline; filename="${encodeURIComponent(filename)}"`
      : `attachment; filename="${encodeURIComponent(filename)}"`;

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
