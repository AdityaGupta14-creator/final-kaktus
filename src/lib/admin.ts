export type KeyHealthStatus = 'healthy' | 'rate_limited' | 'unhealthy' | 'disabled' | 'unknown';

export interface ApiKeyData {
  key: string;
  label: string;
  status: 'active' | 'exhausted';
  addedAt: any;
}

export interface UserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
  planId: string;
  accountStatus: string;
  createdAt: string;
  lastLoginAt: string;
  projectCount?: number;
  subscription?: {
    status: string;
    quotaRemaining: number;
    expiresAt: string | null;
  } | null;
}

export interface MaskedApiKeyData {
  id: string;
  provider: 'Gemini';
  label: string;
  maskedKey: string;
  status: KeyHealthStatus;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt?: string;
  lastUsedAt?: string;
  lastErrorAt?: string;
  errorCount?: number;
  consecutiveFailures?: number;
}

export interface AdminApiPoolResponse {
  keys: MaskedApiKeyData[];
  stats?: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    rateLimitedRequests: number;
    activeKeysCount: number;
    healthyKeysCount: number;
    unhealthyKeysCount: number;
  };
  logs?: Array<{
    id: string;
    type: string;
    timestamp: string;
    details: Record<string, unknown>;
  }>;
}

/**
 * Client-facing API pool fetch for Hardware IDE / PCB Designer.
 * Returns server-managed reference token to ensure raw keys never reach the browser.
 */
export const getApiPool = async (): Promise<ApiKeyData[]> => {
  return [
    {
      key: 'server_managed',
      label: 'Kaktus Managed Cloud Gemini',
      status: 'active',
      addedAt: new Date().toISOString(),
    },
  ];
};

/**
 * Fetch masked API keys and usage statistics for the Admin Dashboard
 */
export async function fetchAdminApiPool(idToken: string): Promise<AdminApiPoolResponse> {
  try {
    const res = await fetch('/api/admin/api-pool', {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) {
      console.warn('[Admin] Failed to fetch API pool:', res.statusText);
      return { keys: [] };
    }
    const data = await res.json();
    return {
      keys: data.keys || [],
      stats: data.stats,
      logs: data.logs,
    };
  } catch (error) {
    console.error('[Admin] Error fetching API pool:', error);
    return { keys: [] };
  }
}

/**
 * Add an API key to the server pool via secure admin route
 */
export async function addAdminApiKey(idToken: string, key: string, label: string): Promise<MaskedApiKeyData[]> {
  const res = await fetch('/api/admin/api-pool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'add', key, label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add API key.');
  }
  const data = await res.json();
  return data.keys || [];
}

/**
 * Remove an API key from the server pool via secure admin route
 */
export async function deleteAdminApiKey(idToken: string, keyId: string): Promise<MaskedApiKeyData[]> {
  const res = await fetch('/api/admin/api-pool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'delete', keyId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete API key.');
  }
  const data = await res.json();
  return data.keys || [];
}

/**
 * Toggle enable/disable status of an API key
 */
export async function toggleAdminApiKey(idToken: string, keyId: string, enabled: boolean): Promise<MaskedApiKeyData[]> {
  const res = await fetch('/api/admin/api-pool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'toggle', keyId, enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to toggle API key.');
  }
  const data = await res.json();
  return data.keys || [];
}

/**
 * Tests health of an API key from the server
 */
export async function testAdminApiKey(idToken: string, keyId: string): Promise<{ success: boolean; latencyMs?: number; error?: string; keys: MaskedApiKeyData[] }> {
  const res = await fetch('/api/admin/api-pool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'test', keyId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to test API key.');
  }
  return {
    success: data.success,
    latencyMs: data.testResult?.latencyMs,
    error: data.testResult?.error,
    keys: data.keys || [],
  };
}

export async function fetchAdminUsers(idToken: string): Promise<UserData[]> {
  const res = await fetch('/api/admin/users', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error('Failed to fetch users');
  }
  const data = await res.json();
  return data.users || [];
}

export async function assignUserRole(idToken: string, targetUid: string, newRole: string): Promise<void> {
  const res = await fetch('/api/admin/users/role', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ uid: targetUid, role: newRole }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update role');
  }
}

export async function toggleUserSuspension(idToken: string, targetUid: string, suspend: boolean, reason: string): Promise<void> {
  const res = await fetch('/api/admin/users/suspend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ uid: targetUid, suspend, reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update suspension status');
  }
}

export const updateApiPool = async (_keys: any[]) => {
  // Deprecated: client direct writes to Firestore are forbidden.
};
