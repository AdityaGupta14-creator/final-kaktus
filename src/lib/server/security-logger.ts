export type SecurityEventType = 
  | 'API_KEY_ADDED'
  | 'API_KEY_DISABLED'
  | 'API_KEY_ENABLED'
  | 'API_KEY_RATE_LIMITED'
  | 'API_KEY_UNHEALTHY'
  | 'API_KEY_RECOVERED'
  | 'API_FAILOVER'
  | 'USER_RATE_LIMITED'
  | 'API_REQUEST_FAILED'
  | 'ENTITLEMENT_DENIED'
  | 'AUTH_FAILURE'
  | 'ROLE_ASSIGNED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_RESTORED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'SETTINGS_UPDATED'
  | 'API_KEY_DELETED'
  | 'REFUND_ISSUED'
  | 'QUOTA_ADJUSTED'
  | 'EARLY_ACCESS_FEATURE_UPDATED'
  | 'EARLY_ACCESS_FEEDBACK_UPDATED'
  | 'EARLY_ACCESS_GRANTED'
  | 'EARLY_ACCESS_REVOKED'
  | 'EARLY_ACCESS_FEEDBACK_SUBMITTED';

export interface SecurityLogEvent {
  id: string;
  type: SecurityEventType;
  timestamp: string;
  actor: {
    uid: string;
    role?: string;
    email?: string;
  };
  details: Record<string, unknown>;
}

import { db } from './firebase-admin';

// We no longer rely on an in-memory log buffer.
// We use Firestore `audit_logs` collection for durable persistence.

/**
 * Strips or masks any potential secrets before logging
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sanitizeValue = (key: string, value: unknown): unknown => {
    const lowerKey = key.toLowerCase();
    const isSensitive = lowerKey.includes('key') || lowerKey.includes('secret') || 
                        lowerKey.includes('token') || lowerKey.includes('auth') || 
                        lowerKey.includes('password') || lowerKey.includes('message') || 
                        lowerKey.includes('content');

    if (isSensitive) {
      if (typeof value === 'string') {
        return value.length > 6 ? `••••••••${value.slice(-4)}` : '••••••••';
      }
      return '[REDACTED]';
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nested[k] = sanitizeValue(k, v);
      }
      return nested;
    }

    if (Array.isArray(value)) {
      return value.map((v, i) => sanitizeValue(`${key}[${i}]`, v));
    }

    return value;
  };

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

/**
 * Allows test suites to isolate or capture security audit events in-memory.
 * In production mode, this is strictly ignored to guarantee audit persistence cannot be overridden.
 */
export function setSecurityLogSinkForTesting(sink: ((event: SecurityLogEvent) => Promise<void> | void) | null): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  (globalThis as any).__kaktus_security_log_sink__ = sink;
}

export async function logSecurityEvent(
  type: SecurityEventType,
  actor: { uid: string; role?: string; email?: string },
  details: Record<string, unknown> = {}
): Promise<void> {
  const sanitized = sanitizeDetails(details);
  const event: SecurityLogEvent = {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    timestamp: new Date().toISOString(),
    actor,
    details: sanitized,
  };

  // Server console output
  console.log(`[SecurityAudit] [${event.type}] Actor:${actor.uid} ${JSON.stringify(sanitized)}`);

  const customLogSink = process.env.NODE_ENV !== 'production' 
    ? (globalThis as any).__kaktus_security_log_sink__ 
    : null;

  if (customLogSink) {
    try {
      await customLogSink(event);
    } catch (err) {
      console.error('[SecurityAudit] Test sink failed:', err);
    }
    return;
  }

  try {
    await db.collection('audit_logs').doc(event.id).set(event);
  } catch (error) {
    console.error(`[SecurityAudit] FAILED TO PERSIST LOG [${event.type}]`, error);
    // Failure policy: We log the failure to standard error but do not throw to avoid crashing
    // the application or inadvertently reporting a successful business operation as a 500 error,
    // which would violate the requirement: "Handle logging failures without accidentally reporting
    // an unsuccessful business operation as successful." The console.error ensures it is captured by host infrastructure.
  }
}

/**
 * Retrieves the recent security events for admin inspection from Firestore
 */
export async function getRecentSecurityLogs(limit = 100, cursorTimestamp?: string): Promise<SecurityLogEvent[]> {
  try {
    let query = db.collection('audit_logs').orderBy('timestamp', 'desc').limit(limit);
    if (cursorTimestamp) {
      query = query.startAfter(cursorTimestamp);
    }
    
    const snap = await query.get();
    return snap.docs.map(doc => doc.data() as SecurityLogEvent);
  } catch (error) {
    console.error('[SecurityAudit] Failed to retrieve logs:', error);
    return [];
  }
}
