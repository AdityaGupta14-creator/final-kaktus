export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    await requireAuthenticatedUser(request);
    return Response.json({
      error: 'Paid plans activate only after payment verification.'
    }, { status: 403 });
  } catch (error) {
    return handleAuthError(error);
  }
}
