export const runtime = 'nodejs';

import { requireAdmin, requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';

import { logSecurityEvent } from '@/lib/server/security-logger';

export async function GET(request: Request) {
  try {
    await requireAuthenticatedUser(request);
    const docSnap = await db.collection('admin').doc('settings').get();
    if (docSnap.exists) {
      const data = docSnap.data();
      return Response.json({
        upiId: data?.payment?.upiId || '',
        upiQrUrl: data?.payment?.upiQrUrl || '',
      });
    }
    return Response.json({ upiId: '', upiQrUrl: '' });
  } catch (error: any) {
    if (error.name === 'AuthError') return handleAuthError(error);
    console.warn('[AdminSettings] Could not query Firestore for settings (service account may be unset in dev):', error.message);
    return Response.json({ upiId: '', upiQrUrl: '' });
  }
}

export async function POST(request: Request) {
  try {
    // Only verified admin can update settings
    await requireAdmin(request);

    const body = await request.json();
    const upiId = typeof body.upiId === 'string' ? body.upiId.trim() : '';
    const upiQrUrl = typeof body.upiQrUrl === 'string' ? body.upiQrUrl.trim() : '';

    await db.collection('admin').doc('settings').set(
      {
        payment: {
          upiId,
          upiQrUrl,
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );

    // Caller is guaranteed to be admin since we awaited requireAdmin
    const caller = await requireAdmin(request);
    logSecurityEvent('SETTINGS_UPDATED', { uid: caller.uid, role: caller.role, email: caller.email || undefined }, {
      upiId: upiId.length > 0 ? '[UPDATED]' : '[CLEARED]',
      upiQrUrl: upiQrUrl.length > 0 ? '[UPDATED]' : '[CLEARED]'
    });

    return Response.json({
      success: true,
      payment: { upiId, upiQrUrl },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
