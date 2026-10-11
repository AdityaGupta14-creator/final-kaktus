export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { auth, getBootstrapSuperAdminEmails } from '@/lib/server/firebase-admin';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(request: Request) {
  try {
    // 1. Only SUPER_ADMIN can suspend accounts
    const caller = await requireRole(request, ['SUPER_ADMIN']);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    const targetUid = typeof body.uid === 'string' ? body.uid.trim() : '';
    const suspend = typeof body.suspend === 'boolean' ? body.suspend : true;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!targetUid) {
      return Response.json({ error: 'Target user UID is required.' }, { status: 400 });
    }

    // 2. Prevent user from suspending their own account
    if (caller.uid === targetUid) {
      return Response.json({ error: 'Self-modification forbidden. You cannot suspend your own account.' }, { status: 400 });
    }

    // 3. Verify target user exists in Firebase Auth
    let targetUserRecord;
    try {
      targetUserRecord = await auth.getUser(targetUid);
    } catch (err: any) {
      return Response.json({ error: `User with UID '${targetUid}' not found: ${err.message}` }, { status: 404 });
    }

    // 4. SUPER_ADMIN Protection: Prevent modifying/downgrading bootstrap SUPER_ADMIN account
    const superAdminEmails = getBootstrapSuperAdminEmails();
    const targetEmail = (targetUserRecord.email || '').toLowerCase().trim();
    if (superAdminEmails.includes(targetEmail)) {
      return Response.json({
        error: 'Forbidden. The bootstrap SUPER_ADMIN account cannot be suspended.',
      }, { status: 403 });
    }

    // 5. Suspend or unsuspend using Firebase Admin SDK
    await auth.updateUser(targetUid, { disabled: suspend });

    logSecurityEvent(suspend ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_RESTORED', { uid: caller.uid, role: caller.role, email: caller.email || undefined }, {
      targetUid,
      targetEmail,
      reason,
    });

    return Response.json({
      success: true,
      uid: targetUid,
      status: suspend ? 'suspended' : 'active',
      message: suspend ? 'Account has been suspended.' : 'Account has been restored.',
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
