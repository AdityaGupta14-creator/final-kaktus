export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';

export async function GET(request: Request) {
  try {
    const caller = await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);
    return Response.json({
      authenticated: true,
      uid: caller.uid,
      email: caller.email,
      role: caller.role,
      isAdmin: ['SUPER_ADMIN', 'ADMIN'].includes(caller.role),
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
