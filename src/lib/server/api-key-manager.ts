import { db } from './firebase-admin';
import { logSecurityEvent } from './security-logger';

export type KeyHealthStatus = 'healthy' | 'rate_limited' | 'unhealthy' | 'disabled' | 'unknown';

export interface ManagedApiKey {
  id: string;
  provider: 'Gemini';
  label: string;
  key: string; // Plaintext secret, strictly server-only!
  maskedKey: string;
  status: KeyHealthStatus;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt?: string;
  lastUsedAt?: string;
  lastErrorAt?: string;
  errorCount: number;
  consecutiveFailures: number;
  rateLimitedUntil?: number; // epoch ms
  cooldownUntil?: number; // epoch ms
}

export interface MaskedApiKeyView {
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
  errorCount: number;
  consecutiveFailures: number;
}

export function maskKey(rawKey: string): string {
  if (!rawKey || rawKey.length < 6) return '••••••••';
  return `••••••••${rawKey.slice(-4)}`;
}

export type ErrorClassification = 'RATE_LIMIT' | 'AUTH_FAILURE' | 'SERVER_ERROR' | 'CLIENT_ERROR';

export function classifyProviderError(status: number, message: string): ErrorClassification {
  const msg = (message || '').toLowerCase();
  if (status === 429 || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('rate limit')) {
    return 'RATE_LIMIT';
  }
  if (status === 401 || (status === 403 && (msg.includes('api key') || msg.includes('credential') || msg.includes('unregistered')))) {
    return 'AUTH_FAILURE';
  }
  if (status === 400 || status === 413 || msg.includes('invalid argument') || msg.includes('malformed')) {
    return 'CLIENT_ERROR';
  }
  return 'SERVER_ERROR';
}

class ApiKeyManager {
  private cache: ManagedApiKey[] | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 45_000;

  /**
   * Loads keys from Firestore and environment variables with in-memory caching
   */
  async getKeys(): Promise<ManagedApiKey[]> {
    const now = Date.now();
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    const loadedKeys: ManagedApiKey[] = [];

    // 1. Check direct environment variable
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      const envKey = process.env.GEMINI_API_KEY.trim();
      loadedKeys.push({
        id: 'env_primary_gemini',
        provider: 'Gemini',
        label: 'Primary Environment Key',
        key: envKey,
        maskedKey: maskKey(envKey),
        status: 'healthy',
        enabled: true,
        createdAt: new Date().toISOString(),
        errorCount: 0,
        consecutiveFailures: 0,
      });
    }

    // 2. Fetch from secure Firestore admin/apiPool
    try {
      const docSnap = await db.collection('admin').doc('apiPool').get();
      if (docSnap.exists) {
        const rawList = docSnap.data()?.keys || [];
        rawList.forEach((item: any, idx: number) => {
          if (!item.key) return;
          const keyStr = String(item.key).trim();
          // Avoid duplicate of environment key
          if (loadedKeys.some(k => k.key === keyStr)) return;

          loadedKeys.push({
            id: item.id || `key_${idx}_${keyStr.slice(-4)}`,
            provider: 'Gemini',
            label: item.label || `Gemini Key #${idx + 1}`,
            key: keyStr,
            maskedKey: maskKey(keyStr),
            status: item.status === 'exhausted' ? 'rate_limited' : (item.status || 'healthy'),
            enabled: item.enabled !== false,
            createdAt: item.addedAt || item.createdAt || new Date().toISOString(),
            lastCheckedAt: item.lastCheckedAt,
            lastUsedAt: item.lastUsedAt,
            lastErrorAt: item.lastErrorAt,
            errorCount: Number(item.errorCount) || 0,
            consecutiveFailures: Number(item.consecutiveFailures) || 0,
            rateLimitedUntil: item.rateLimitedUntil,
            cooldownUntil: item.cooldownUntil,
          });
        });
      }
    } catch (err) {
      console.warn('[ApiKeyManager] Could not read Firestore pool (using environment key if available):', (err as Error).message);
    }

    this.cache = loadedKeys;
    this.cacheTimestamp = now;
    return loadedKeys;
  }

  /**
   * Invalidates in-memory cache to force fresh read
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Returns list of masked keys for admin dashboard (never exposes plaintext keys)
   */
  async listMaskedKeys(): Promise<MaskedApiKeyView[]> {
    const keys = await this.getKeys();
    const now = Date.now();

    return keys.map(k => {
      // Auto-recover rate-limited keys if cooldown passed
      let currentStatus = k.status;
      if (currentStatus === 'rate_limited' && k.rateLimitedUntil && k.rateLimitedUntil < now) {
        currentStatus = 'healthy';
      }

      return {
        id: k.id,
        provider: k.provider,
        label: k.label,
        maskedKey: k.maskedKey,
        status: currentStatus,
        enabled: k.enabled,
        createdAt: k.createdAt,
        lastCheckedAt: k.lastCheckedAt,
        lastUsedAt: k.lastUsedAt,
        lastErrorAt: k.lastErrorAt,
        errorCount: k.errorCount,
        consecutiveFailures: k.consecutiveFailures,
      };
    });
  }

  /**
   * Adds a new API key to the secure pool
   */
  async addKey(rawKey: string, label: string, actor?: { uid: string; role?: string; email?: string }): Promise<MaskedApiKeyView[]> {
    const trimmed = rawKey.trim();
    if (!trimmed || trimmed.length < 10) {
      throw new Error('Valid Gemini API key required (minimum 10 characters).');
    }

    const docRef = db.collection('admin').doc('apiPool');
    const docSnap = await docRef.get();
    const currentList: any[] = (docSnap.exists ? docSnap.data()?.keys || [] : []);

    const newKeyRecord = {
      id: `key_${Date.now()}_${trimmed.slice(-4)}`,
      provider: 'Gemini',
      label: label.trim() || `Gemini Key #${currentList.length + 1}`,
      key: trimmed,
      status: 'healthy',
      enabled: true,
      addedAt: new Date().toISOString(),
      errorCount: 0,
      consecutiveFailures: 0,
    };

    currentList.push(newKeyRecord);
    await docRef.set({ keys: currentList }, { merge: true });

    this.invalidateCache();
    logSecurityEvent('API_KEY_ADDED', actor || { uid: 'SYSTEM' }, { id: newKeyRecord.id, label: newKeyRecord.label });

    return this.listMaskedKeys();
  }

  /**
   * Deletes an API key from the pool
   */
  async deleteKey(keyId: string, actor?: { uid: string; role?: string; email?: string }): Promise<MaskedApiKeyView[]> {
    if (keyId === 'env_primary_gemini') {
      throw new Error('Cannot delete environment-configured API key via dashboard.');
    }

    const docRef = db.collection('admin').doc('apiPool');
    const docSnap = await docRef.get();
    let currentList: any[] = (docSnap.exists ? docSnap.data()?.keys || [] : []);

    currentList = currentList.filter((item, idx) => {
      const explicitId = item.id;
      const idWithIdx = `key_${idx}_${item.key?.slice(-4)}`;
      const idWithoutIdx = `key_${item.key?.slice(-4)}`;
      return explicitId !== keyId && idWithIdx !== keyId && idWithoutIdx !== keyId && item.key !== keyId;
    });

    await docRef.set({ keys: currentList }, { merge: true });
    this.invalidateCache();

    return this.listMaskedKeys();
  }

  /**
   * Toggles enable/disable status for an API key
   */
  async toggleKey(keyId: string, enabled: boolean, actor?: { uid: string; role?: string; email?: string }): Promise<MaskedApiKeyView[]> {
    const docRef = db.collection('admin').doc('apiPool');
    const docSnap = await docRef.get();
    const currentList: any[] = (docSnap.exists ? docSnap.data()?.keys || [] : []);

    const found = currentList.find((item, idx) => {
      const explicitId = item.id;
      const idWithIdx = `key_${idx}_${item.key?.slice(-4)}`;
      const idWithoutIdx = `key_${item.key?.slice(-4)}`;
      return explicitId === keyId || idWithIdx === keyId || idWithoutIdx === keyId || item.key === keyId;
    });

    if (found) {
      found.enabled = enabled;
      found.status = enabled ? 'healthy' : 'disabled';
      await docRef.set({ keys: currentList }, { merge: true });
      this.invalidateCache();

      logSecurityEvent(enabled ? 'API_KEY_ENABLED' : 'API_KEY_DISABLED', actor || { uid: 'SYSTEM' }, { keyId });
    }

    return this.listMaskedKeys();
  }

  /**
   * Runs a live health check against Gemini for a specific key
   */
  async testKeyHealth(keyId: string, actor?: { uid: string; role?: string; email?: string }): Promise<{ success: boolean; status: KeyHealthStatus; latencyMs: number; error?: string }> {
    const keys = await this.getKeys();
    const target = keys.find(k => k.id === keyId || k.maskedKey.includes(keyId));
    if (!target) {
      throw new Error('API key not found.');
    }

    const startTime = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(target.key)}`, {
        signal: AbortSignal.timeout(7000),
      });
      const latencyMs = Date.now() - startTime;
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.models) {
        target.status = 'healthy';
        target.consecutiveFailures = 0;
        target.lastCheckedAt = new Date().toISOString();
        return { success: true, status: 'healthy', latencyMs };
      }

      const classification = classifyProviderError(res.status, data.error?.message || '');
      let newStatus: KeyHealthStatus = 'unhealthy';
      if (classification === 'RATE_LIMIT') newStatus = 'rate_limited';

      target.status = newStatus;
      target.lastCheckedAt = new Date().toISOString();
      target.lastErrorAt = new Date().toISOString();
      target.errorCount++;

      return {
        success: false,
        status: newStatus,
        latencyMs,
        error: data.error?.message || `HTTP ${res.status}`,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      target.status = 'unhealthy';
      target.lastCheckedAt = new Date().toISOString();
      return {
        success: false,
        status: 'unhealthy',
        latencyMs,
        error: err.message || 'Timeout / Network Error',
      };
    }
  }

  /**
   * Automatic rotation with bounded failover across eligible keys
   */
  async executeWithFailover<T>(
    operation: (activeKey: string, keyId: string) => Promise<{ result: T; status: number; error?: string }>
  ): Promise<{ result: T; keyId: string; attempts: number }> {
    const keys = await this.getKeys();
    const now = Date.now();

    // Filter eligible keys
    const eligible = keys.filter(k => {
      if (!k.enabled) return false;
      if (k.status === 'disabled') return false;
      if (k.status === 'rate_limited' && k.rateLimitedUntil && k.rateLimitedUntil > now) return false;
      if (k.cooldownUntil && k.cooldownUntil > now) return false;
      return true;
    });

    if (eligible.length === 0) {
      throw new Error('All Gemini provider keys are currently exhausted or unavailable. Please retry in a moment.');
    }

    // Auto-recover any keys whose rate-limit cooldown has elapsed
    for (const k of eligible) {
      if (k.status === 'rate_limited' && k.rateLimitedUntil && k.rateLimitedUntil <= now) {
        k.status = 'healthy';
        k.rateLimitedUntil = undefined;
        logSecurityEvent('API_KEY_RECOVERED', { uid: 'SYSTEM' }, { keyId: k.id });
      }
    }

    // Sort: lowest consecutive failures first, least recently used
    eligible.sort((a, b) => {
      if (a.consecutiveFailures !== b.consecutiveFailures) {
        return a.consecutiveFailures - b.consecutiveFailures;
      }
      return (a.lastUsedAt || '').localeCompare(b.lastUsedAt || '');
    });

    // Bound maximum failovers
    const maxAttempts = Math.min(eligible.length, 5);
    let lastErrorMsg = 'Provider request failed';
    let attempts = 0;

    for (let i = 0; i < maxAttempts; i++) {
      attempts++;
      const currentKey = eligible[i];

      try {
        const { result, status, error } = await operation(currentKey.key, currentKey.id);

        if (status >= 200 && status < 300) {
          // Success!
          currentKey.lastUsedAt = new Date().toISOString();
          currentKey.consecutiveFailures = 0;
          if (currentKey.status === 'rate_limited' || currentKey.status === 'unknown') {
            currentKey.status = 'healthy';
          }
          return { result, keyId: currentKey.id, attempts };
        }

        // Provider responded with error
        lastErrorMsg = error || `HTTP ${status}`;
        const classification = classifyProviderError(status, lastErrorMsg);

        if (classification === 'CLIENT_ERROR') {
          // Client sent invalid prompt/payload. Do not rotate keys!
          throw new Error(lastErrorMsg);
        }

        currentKey.errorCount++;
        currentKey.consecutiveFailures++;
        currentKey.lastErrorAt = new Date().toISOString();

        if (classification === 'RATE_LIMIT') {
          currentKey.status = 'rate_limited';
          currentKey.rateLimitedUntil = Date.now() + 60_000;
          logSecurityEvent('API_KEY_RATE_LIMITED', { uid: 'SYSTEM' }, { keyId: currentKey.id, attempts });
        } else if (classification === 'AUTH_FAILURE') {
          currentKey.status = 'unhealthy';
          logSecurityEvent('API_KEY_UNHEALTHY', { uid: 'SYSTEM' }, { keyId: currentKey.id, reason: 'Invalid or revoked credentials' });
        } else {
          // Server error / network
          currentKey.cooldownUntil = Date.now() + 15_000;
        }

        logSecurityEvent('API_FAILOVER', { uid: 'SYSTEM' }, {
          failedKeyId: currentKey.id,
          attempt: i + 1,
          nextKeyAvailable: i + 1 < maxAttempts,
        });

      } catch (err: any) {
        // If client error, re-throw immediately
        if (err.message === lastErrorMsg && !err.message.includes('HTTP 5') && !err.message.includes('429')) {
          throw err;
        }
        lastErrorMsg = err.message || 'Unknown network error';
      }
    }

    throw new Error('Service temporarily unavailable due to upstream provider rate limits. Please try again shortly.');
  }
}

export const apiKeyManager = new ApiKeyManager();
