export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { createTerminalTicket } from '@/lib/server/terminal-ticket';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const ticket = createTerminalTicket(user.uid);
    return Response.json({ ticket });
  } catch (error) {
    return handleAuthError(error);
  }
}
