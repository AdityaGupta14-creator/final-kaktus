export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { auth, setUserTestQuotaMode } from '@/lib/server/firebase-admin';
import { isValidTestQuotaMode, TestQuotaMode } from '@/lib/server/roles';
import { logSecurityEvent } from '@/lib/server/security-logger';

export async function POST(request: Request) {
  try {
    // 1. Only SUPER_ADMIN can adjust quota mode
    const caller = await requireRole(request, ['SUPER_ADMIN']);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }

    const targetUid = typeof body.uid === 'string' ? body.uid.trim() : '';
    const quotaMode = typeof body.quotaMode === 'string' ? body.quotaMode.trim() : '';

    if (!targetUid) {
      return Response.json({ error: 'Target user UID is required.' }, { status: 400 });
    }

    if (!isValidTestQuotaMode(quotaMode)) {
      return Response.json({
        error: `Invalid quota mode '${quotaMode}'. Valid modes: STANDARD, HIGH, UNLIMITED.`,
      }, { status: 400 });
    }

    // 2. Prevent user from modifying their own quota mode
    if (caller.uid === targetUid) {
      return Response.json({ error: 'Self-modification forbidden. You cannot change your own quota mode.' }, { status: 400 });
    }

    // 3. Verify target user exists
    let targetUserRecord;
    try {
      targetUserRecord = await auth.getUser(targetUid);
    } catch (err: any) {
      return Response.json({ error: `User with UID '${targetUid}' not found: ${err.message}` }, { status: 404 });
    }

    const targetEmail = (targetUserRecord.email || '').toLowerCase().trim();

    // 4. Update the test quota mode in custom claims and Firestore
    await setUserTestQuotaMode(targetUid, quotaMode as TestQuotaMode);

    logSecurityEvent('TEST_QUOTA_MODE_CHANGED', { uid: caller.uid, role: caller.role, email: caller.email || undefined }, {
      targetUid,
      targetEmail,
      testQuotaMode: quotaMode,
    });

    return Response.json({
      success: true,
      uid: targetUid,
      testQuotaMode: quotaMode,
      targetEmail: targetEmail || null,
      message: `Test quota mode updated to ${quotaMode} successfully. Changes take effect on next token refresh.`,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
