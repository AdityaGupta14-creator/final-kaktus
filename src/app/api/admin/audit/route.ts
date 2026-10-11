export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { getRecentSecurityLogs } from '@/lib/server/security-logger';

export async function GET(request: Request) {
  try {
    // Both ADMIN and SUPER_ADMIN can view audit logs
    await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const cursor = url.searchParams.get('cursor') || undefined;

    const logs = await getRecentSecurityLogs(limit, cursor);

    return Response.json({ logs });
  } catch (error) {
    return handleAuthError(error);
  }
}
