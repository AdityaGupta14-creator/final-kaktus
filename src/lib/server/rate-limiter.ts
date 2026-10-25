import { logSecurityEvent } from './security-logger';
import crypto from 'crypto';

interface RateLimitEntry {
  timestamps: number[];
}

// In-memory sliding window store
const rateLimitMap = new Map<string, RateLimitEntry>();
const rateLimitLogAt = new Map<string, number>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  totalLimit: number;
}

/**
 * Checks and updates sliding-window rate limit for a given user or client identifier
 */
export function checkRateLimit(identifier: string, endpoint = 'api'): RateLimitResult {
  const windowSeconds = Number(process.env.API_RATE_LIMIT_WINDOW_SECONDS) || 60;
  const maxRequests = Number(process.env.API_RATE_LIMIT_REQUESTS) || 30;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  const key = `${endpoint}:${identifier}`;
  let entry = rateLimitMap.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(key, entry);
  }

  // Purge expired timestamps from sliding window
  entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);

  const currentCount = entry.timestamps.length;
  const oldestTimestamp = entry.timestamps[0] || now;
  const resetSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

  if (currentCount >= maxRequests) {
    const lastLoggedAt = rateLimitLogAt.get(key) || 0;
    if (now - lastLoggedAt >= windowMs) {
      rateLimitLogAt.set(key, now);
      logSecurityEvent('USER_RATE_LIMITED', { uid: identifier }, {
        endpoint,
        currentCount,
        maxRequests,
        resetSeconds,
      });
    }

    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
      totalLimit: maxRequests,
    };
  }

  // Record this request timestamp
  entry.timestamps.push(now);

  if (rateLimitMap.size > 10_000) {
    for (const [storedKey, storedEntry] of rateLimitMap) {
      storedEntry.timestamps = storedEntry.timestamps.filter(ts => ts > cutoff);
      if (storedEntry.timestamps.length === 0) {
        rateLimitMap.delete(storedKey);
        rateLimitLogAt.delete(storedKey);
      }
    }
  }

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetSeconds,
    totalLimit: maxRequests,
  };
}

/**
 * Distributed limiter for serverless deployments when Upstash Redis credentials are set.
 * Keeps the in-memory limiter as a local-development fallback so the app remains usable.
 */
export async function checkSharedRateLimit(
  identifier: string,
  endpoint = 'api',
  maxRequests = Number(process.env.API_RATE_LIMIT_REQUESTS) || 30,
  windowSeconds = Number(process.env.API_RATE_LIMIT_WINDOW_SECONDS) || 60,
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return checkRateLimit(identifier, endpoint);

  const now = Date.now();
  const safeIdentity = crypto.createHash('sha256').update(identifier).digest('hex');
  const key = `kaktus:rate:${endpoint}:${safeIdentity}`;
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}";
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, '1', key, String(windowSeconds * 1000)]),
      signal: AbortSignal.timeout(2_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Rate limit service returned ${response.status}`);
    const payload = await response.json();
    const result = payload?.result;
    if (!Array.isArray(result) || result.length < 2) throw new Error('Invalid rate limit response');
    const count = Number(result[0]);
    const ttlMs = Math.max(1, Number(result[1]));
    const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const allowed = Number.isFinite(count) && count <= maxRequests;
    if (!allowed) {
      logSecurityEvent('USER_RATE_LIMITED', { uid: safeIdentity }, { endpoint, currentCount: count, maxRequests, resetSeconds });
    }
    return {
      allowed,
      remaining: Math.max(0, maxRequests - count),
      resetSeconds,
      totalLimit: maxRequests,
    };
  } catch (error) {
    console.error('[RateLimit] Shared store unavailable; using local fallback:', error instanceof Error ? error.name : 'Unknown error');
    return checkRateLimit(identifier, endpoint);
  }
}

/**
 * Helper to generate 429 Rate Limit Response with standard headers
 */
export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: 'Too many requests. Please try again shortly.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: result.resetSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.resetSeconds),
        'X-RateLimit-Limit': String(result.totalLimit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.resetSeconds),
      },
    }
  );
}
