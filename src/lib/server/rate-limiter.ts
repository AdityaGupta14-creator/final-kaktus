import { logSecurityEvent } from './security-logger';

interface RateLimitEntry {
  timestamps: number[];
}

// In-memory sliding window store
const rateLimitMap = new Map<string, RateLimitEntry>();

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
    logSecurityEvent('USER_RATE_LIMITED', { uid: identifier }, {
      endpoint,
      currentCount,
      maxRequests,
      resetSeconds,
    });

    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
      totalLimit: maxRequests,
    };
  }

  // Record this request timestamp
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetSeconds,
    totalLimit: maxRequests,
  };
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
