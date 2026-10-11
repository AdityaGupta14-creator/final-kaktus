export const runtime = 'nodejs';

import { requireAdmin, handleAuthError } from '@/lib/server/auth';
import { apiKeyManager } from '@/lib/server/api-key-manager';
import { getUsageStats } from '@/lib/server/usage-meter';
import { getRecentSecurityLogs } from '@/lib/server/security-logger';

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const keys = await apiKeyManager.listMaskedKeys();
    const stats = await getUsageStats();
    const logs = await getRecentSecurityLogs(15);

    return Response.json({
      keys,
      stats: {
        ...stats,
        activeKeysCount: keys.filter(k => k.enabled && k.status === 'healthy').length,
        healthyKeysCount: keys.filter(k => k.status === 'healthy').length,
        unhealthyKeysCount: keys.filter(k => k.status === 'unhealthy' || k.status === 'rate_limited').length,
      },
      logs,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = await request.json();

    const action = body.action;

    if (action === 'add') {
      const { key, label } = body;
      const caller = await requireAdmin(request);
      const updatedKeys = await apiKeyManager.addKey(key, label, { uid: caller.uid, role: caller.role, email: caller.email || undefined });
      return Response.json({ success: true, keys: updatedKeys });
    }

    if (action === 'delete') {
      const { keyId } = body;
      if (!keyId) return Response.json({ error: 'keyId is required to delete.' }, { status: 400 });
      const caller = await requireAdmin(request);
      const updatedKeys = await apiKeyManager.deleteKey(keyId, { uid: caller.uid, role: caller.role, email: caller.email || undefined });
      return Response.json({ success: true, keys: updatedKeys });
    }

    if (action === 'toggle') {
      const { keyId, enabled } = body;
      if (!keyId) return Response.json({ error: 'keyId is required.' }, { status: 400 });
      const caller = await requireAdmin(request);
      const updatedKeys = await apiKeyManager.toggleKey(keyId, enabled === true, { uid: caller.uid, role: caller.role, email: caller.email || undefined });
      return Response.json({ success: true, keys: updatedKeys });
    }

    if (action === 'test') {
      const { keyId } = body;
      if (!keyId) return Response.json({ error: 'keyId is required for testing.' }, { status: 400 });
      const caller = await requireAdmin(request);
      const testResult = await apiKeyManager.testKeyHealth(keyId, { uid: caller.uid, role: caller.role, email: caller.email || undefined });
      const updatedKeys = await apiKeyManager.listMaskedKeys();
      return Response.json({
        success: testResult.success,
        testResult,
        keys: updatedKeys,
      });
    }

    return Response.json({ error: 'Invalid action. Supported: add, delete, toggle, test' }, { status: 400 });
  } catch (error: any) {
    if (error.status) return handleAuthError(error);
    return Response.json({ error: error.message || 'Operation failed.' }, { status: 400 });
  }
}
