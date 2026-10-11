import { db } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSecurityEvent } from './security-logger';

export interface ApiUsageRecord {
  uid: string;
  endpoint: string;
  provider: 'Gemini';
  model: string;
  timestamp: string;
  success: boolean;
  failure: boolean;
  errorType?: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  keyId?: string;
}

export interface UsageAggregationStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// In-memory counter for fast admin overview
const memoryStats: UsageAggregationStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  rateLimitedRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

/**
 * Records an API usage event to Firestore and memory stats
 */
export async function recordApiUsage(record: ApiUsageRecord): Promise<void> {
  memoryStats.totalRequests++;
  if (record.success) {
    memoryStats.successfulRequests++;
  } else {
    memoryStats.failedRequests++;
    if (record.errorType === 'RATE_LIMIT') {
      memoryStats.rateLimitedRequests++;
    }
  }

  if (record.inputTokens) memoryStats.totalInputTokens += record.inputTokens;
  if (record.outputTokens) memoryStats.totalOutputTokens += record.outputTokens;

  // Persist to Supabase asynchronously without blocking client response
  try {
    const { adminSupabase } = await import('./supabase');
    const { error: sbError } = await adminSupabase.from('api_usage').insert({
      id: `usage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      user_uid: record.uid,
      endpoint: record.endpoint,
      provider: record.provider,
      model: record.model,
      success: record.success,
      failure: record.failure,
      error_type: record.errorType || null,
      duration_ms: record.durationMs,
      input_tokens: record.inputTokens || null,
      output_tokens: record.outputTokens || null,
      total_tokens: record.totalTokens || null,
      key_id: record.keyId || null
    });
    if (sbError) {
      console.warn('[UsageMeter] Failed to persist usage record to Supabase:', sbError.message);
    }
  } catch (err) {
    console.warn('[UsageMeter] Supabase client error:', (err as Error).message);
  }

  // Persist to Firestore asynchronously (Legacy path for parity check)
  try {
    await db.collection('api_usage').add({
      ...record,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[UsageMeter] Failed to persist usage record to Firestore:', (err as Error).message);
  }
}

/**
 * Retrieves aggregate usage statistics from Supabase for the admin dashboard
 */
export async function getUsageStats(): Promise<UsageAggregationStats> {
  const { adminSupabase } = await import('./supabase');
  const { data, error } = await adminSupabase.from('api_usage').select('success, error_type, input_tokens, output_tokens');
  
  if (error || !data) {
    console.warn('[UsageMeter] Failed to fetch aggregate usage stats from Supabase:', error?.message);
    return { ...memoryStats }; // fallback
  }

  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let rateLimitedRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const row of data) {
    totalRequests++;
    if (row.success) successfulRequests++;
    else {
      failedRequests++;
      if (row.error_type === 'RATE_LIMIT') rateLimitedRequests++;
    }
    if (row.input_tokens) totalInputTokens += row.input_tokens;
    if (row.output_tokens) totalOutputTokens += row.output_tokens;
  }

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    rateLimitedRequests,
    totalInputTokens,
    totalOutputTokens
  };
}

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  decremented: boolean;
}

const PRO_MODELS = ['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-pro'];

/**
 * Validates user plan and consumes a Pro run atomically if required
 */
export async function checkAndConsumeEntitlement(
  uid: string | null | undefined,
  model: string
): Promise<EntitlementCheckResult> {
  // If unauthenticated or no UID
  if (!uid) {
    // We should ideally use the model config, but fallback to PRO_MODELS list check
    const isPro = model.includes('pro') || model.includes('3.7') || model.includes('3.8');
    if (isPro) {
      logSecurityEvent('ENTITLEMENT_DENIED', { uid: 'anonymous' }, { model, reason: 'Pro model requires sign-in' });
      return { allowed: false, reason: 'Sign in to access advanced models.', decremented: false };
    }
    return { allowed: true, decremented: false };
  }

  const isProModel = model.includes('pro') || model.includes('3.7') || model.includes('3.8');
  if (!isProModel) {
    // Standard models do not consume Pro runs
    return { allowed: true, decremented: false };
  }

  try {
    const { adminSupabase } = await import('./supabase');
    const { data: rpcResult, error } = await adminSupabase.rpc('consume_subscription_quota', {
      p_user_uid: uid,
      p_required_quota: 1
    });

    if (error) {
      console.error('[Entitlement] Supabase RPC error, failing CLOSED:', error.message);
      return { allowed: false, reason: 'Failed to verify subscription status.', decremented: false };
    }

    if (rpcResult && rpcResult.allowed) {
      // Check if it's unlimited (e.g. Free plan theoretically doesn't have unlimited PRO, but if we mapped it)
      return { allowed: true, decremented: true };
    }

    // Runs exhausted
    logSecurityEvent('ENTITLEMENT_DENIED', { uid }, { model, reason: rpcResult?.reason });
    return {
      allowed: false,
      reason: rpcResult?.reason || 'Pro runs allowance exhausted. Please upgrade your plan in the Pricing section.',
      decremented: false,
    };
  } catch (err) {
    console.error('[Entitlement] Error checking entitlement, failing CLOSED:', (err as Error).message);
    return { allowed: false, reason: 'Failed to verify subscription status.', decremented: false };
  }
}

/**
 * Restores a consumed Pro run if the generation failed upstream
 */
export async function rollbackEntitlement(uid: string | null | undefined): Promise<void> {
  if (!uid) return;
  try {
    const { adminSupabase } = await import('./supabase');
    const { error } = await adminSupabase.rpc('restore_subscription_quota', {
      p_user_uid: uid,
      p_restored_quota: 1
    });
    if (error) {
      console.warn('[Entitlement] Failed to rollback pro run via Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[Entitlement] Failed to rollback pro run:', (err as Error).message);
  }
}
