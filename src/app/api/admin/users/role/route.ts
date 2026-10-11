export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { auth, setUserRole, getBootstrapSuperAdminEmails } from '@/lib/server/firebase-admin';
import { isAssignableRole } from '@/lib/server/roles';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(request: Request) {
  try {
    // 1. Only SUPER_ADMIN can assign or modify roles
    const caller = await requireRole(request, ['SUPER_ADMIN']);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    const targetUid = typeof body.uid === 'string' ? body.uid.trim() : '';
    const newRole = typeof body.role === 'string' ? body.role.trim() : '';

    if (!targetUid) {
      return Response.json({ error: 'Target user UID is required.' }, { status: 400 });
    }

    if (!isAssignableRole(newRole)) {
      return Response.json({
        error: `Invalid role '${newRole}'. Assignable roles: SUPER_ADMIN, ADMIN, EARLY_ACCESS, USER. FINANCE and SUPPORT are legacy roles that cannot be newly assigned.`,
      }, { status: 400 });
    }

    // 2. Prevent user from changing their own role
    if (caller.uid === targetUid) {
      return Response.json({ error: 'Self-modification forbidden. You cannot change your own role.' }, { status: 400 });
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
        error: 'Forbidden. The bootstrap SUPER_ADMIN account cannot be modified or downgraded via the API.',
      }, { status: 403 });
    }

    // 5. Authoritatively assign the custom claim & mirror to Firestore
    await setUserRole(targetUid, newRole);

    logSecurityEvent('ROLE_ASSIGNED', { uid: caller.uid, role: caller.role, email: caller.email || undefined }, {
      targetUid,
      targetEmail,
      assignedRole: newRole,
    });

    return Response.json({
      success: true,
      uid: targetUid,
      role: newRole,
      targetEmail: targetEmail || null,
      message: 'Role assigned successfully. The user will receive the new permissions on their next token refresh.',
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
