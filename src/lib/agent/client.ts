import type { ImageAttachment } from './image-attachments';
import { getTokenLimit, getStoredTokensUsed, recordTokensUsed, isUserQuotaExceeded } from '@/lib/tokens';

export type AgentPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export interface AgentMessage {
  role: 'user' | 'model';
  parts: AgentPart[];
}

export function toGeminiImagePart(image: ImageAttachment): AgentPart {
  return { inline_data: { mime_type: image.mimeType, data: image.data } };
}

export interface AgentResponse {
  text: string;
  sources: Array<{ title: string; uri: string }>;
  searchQueries: string[];
  researched: boolean;
  taskId?: string;
  durationMs?: number;
}

export type AgentErrorCode = 'APP_QUOTA_EXCEEDED' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_QUOTA_EXHAUSTED' | 'PROVIDER_AUTH_ERROR' | 'API_KEY_MISSING' | 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT' | string;

export class AgentRequestError extends Error {
  readonly code?: AgentErrorCode;
  readonly status?: number;

  constructor(message: string, code?: AgentErrorCode, status?: number) {
    super(message);
    this.name = 'AgentRequestError';
    this.code = code;
    this.status = status;
  }
}

function responseError(data: unknown, status: number): AgentRequestError {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const message = typeof payload.error === 'string' ? payload.error : 'Agent request failed.';
  const code = typeof payload.code === 'string'
    ? payload.code
    : status === 429 ? 'PROVIDER_RATE_LIMIT' : status === 504 ? 'UPSTREAM_TIMEOUT' : undefined;
  return new AgentRequestError(message, code, status);
}

export interface AgentRequest {
  apiKeys: string[];
  model: string;
  systemPrompt: string;
  contents: AgentMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  research?: boolean;
  abortSignal?: AbortSignal;
  taskId?: string;
}

/**
 * Smart key ordering: puts billing-enabled keys (labeled "payed" or "paid" in admin)
 * LAST so they act as a guaranteed fallback. Free keys are shuffled and tried first.
 */
function getOrderedKeys(keys: string[]): string[] {
  if (keys.length <= 1) return keys;

  const billingKeys: string[] = [];
  let freeKeys: string[] = [];

  try {
    const poolRaw = localStorage.getItem('kaktus_api_pool_meta');
    if (poolRaw) {
      const poolMeta: Array<{ key: string; label: string }> = JSON.parse(poolRaw);
      const billingLabels = ['payed', 'paid', 'billing', 'premium'];
      
      for (const k of keys) {
        const meta = poolMeta.find(m => m.key === k);
        if (meta && billingLabels.some(bl => meta.label.toLowerCase().includes(bl))) {
          billingKeys.push(k);
        } else {
          freeKeys.push(k);
        }
      }
    } else {
      freeKeys = [...keys];
    }
  } catch {
    freeKeys = [...keys];
  }

  // Shuffle free keys for load balancing
  for (let i = freeKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeKeys[i], freeKeys[j]] = [freeKeys[j], freeKeys[i]];
  }

  return [...freeKeys, ...billingKeys];
}

function isKeyRecentlyExhausted(key: string, model: string): boolean {
  try {
    const errsRaw = localStorage.getItem('gemini_key_errors');
    if (!errsRaw) return false;
    const errs = JSON.parse(errsRaw);
    const baseModel = model.replace('models/', '');
    const entry = errs?.[key]?.[baseModel];
    if (entry && entry.type === 'QUOTA_EXHAUSTED') {
      return (Date.now() - entry.timestamp) < 60_000;
    }
  } catch {}
  return false;
}

export async function requestAgent(request: AgentRequest): Promise<AgentResponse> {
  const taskId = request.taskId || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

  // Check token limits before making the request
  if (typeof window !== 'undefined') {
    const uid = localStorage.getItem('kaktus_user_uid') || localStorage.getItem('kaktus_user_email');
    const plan = (localStorage.getItem('kaktus_user_plan') || 'free').toLowerCase();
    const planExpiresAt = localStorage.getItem('kaktus_user_plan_expires_at');
    const role = localStorage.getItem('kaktus_user_role') || 'USER';
    const testQuotaMode = localStorage.getItem('kaktus_user_test_quota_mode') || 'HIGH';
    
    if (isUserQuotaExceeded(uid, plan, planExpiresAt, role, testQuotaMode)) {
      const limit = getTokenLimit(plan, planExpiresAt, role, testQuotaMode);
      const currentTotal = getStoredTokensUsed(uid);
      window.dispatchEvent(new CustomEvent('geminiQuotaExceeded', { detail: { currentTotal, limit } }));
      throw new AgentRequestError(`Daily Quota Reached. You have exceeded your ${limit / 1000}k tokens daily limit. Please upgrade your plan to continue.`, 'APP_QUOTA_EXCEEDED', 429);
    }
  }

  // Gather auth header if signed in
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-task-id': taskId,
  };
  if (typeof window !== 'undefined') {
    try {
      const { auth } = await import('@/lib/firebase');
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        authHeaders['Authorization'] = `Bearer ${idToken}`;
      }
    } catch {}
  }

  const isTransientError = (status?: number, code?: string) => {
    if (status === 400 || status === 401 || status === 403 || status === 413) return false;
    if (code === 'APP_QUOTA_EXCEEDED' || code === 'PROVIDER_RATE_LIMIT' || code === 'PROVIDER_QUOTA_EXHAUSTED' || code === 'PROVIDER_AUTH_ERROR' || code === 'API_KEY_MISSING') return false;
    return status === 502 || status === 503 || status === 504 || code === 'UPSTREAM_TIMEOUT' || code === 'UPSTREAM_ERROR' || !status;
  };

  const fetchAttempt = async (targetPayload: Record<string, unknown>, maxRetries = 2) => {
    let attempt = 0;
    while (true) {
      if (request.abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(targetPayload),
          signal: request.abortSignal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const err = responseError(data, response.status);
          if (attempt < maxRetries && isTransientError(err.status, err.code) && !request.abortSignal?.aborted) {
            attempt++;
            const backoffMs = Math.min(2000, 300 * Math.pow(2, attempt)) + Math.random() * 150;
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
          throw err;
        }
        return data;
      } catch (err: any) {
        if (err?.name === 'AbortError' || request.abortSignal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (attempt < maxRetries && isTransientError(err?.status, err?.code) && !request.abortSignal?.aborted) {
          attempt++;
          const backoffMs = Math.min(2000, 300 * Math.pow(2, attempt)) + Math.random() * 150;
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw err instanceof AgentRequestError ? err : new AgentRequestError(err?.message || 'Agent request failed.');
      }
    }
  };

  if (!request.apiKeys || request.apiKeys.length === 0) {
    const payload = { ...request, taskId, apiKey: 'default_server_key' };
    delete (payload as any).apiKeys;

    const data = await fetchAttempt(payload, 2);

    // Track usage for default server key
    if (typeof window !== 'undefined') {
      const tokensUsed = typeof data.usage === 'number' ? data.usage : (data.usage?.totalTokenCount || 0);
      const uid = localStorage.getItem('kaktus_user_uid');
      recordTokensUsed(uid, 'default_server_key', request.model, tokensUsed);
    }

    return {
      text: data.text || '',
      sources: Array.isArray(data.sources) ? data.sources : [],
      searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries : [],
      researched: data.researched === true,
      taskId: data.taskId || taskId,
      durationMs: data.durationMs,
    };
  }

  const orderedKeys = typeof window !== 'undefined' 
    ? getOrderedKeys(request.apiKeys) 
    : [...request.apiKeys];
  
  let lastError: AgentRequestError | null = null;
  let lastQuotaError: AgentRequestError | null = null;
  let triedCount = 0;

  for (const key of orderedKeys) {
    if (typeof window !== 'undefined' && isKeyRecentlyExhausted(key, request.model)) {
      console.log(`[Smart Handler] Skipping recently exhausted key ...${key.slice(-4)}`);
      continue;
    }

    triedCount++;

    try {
      const payload = { ...request, taskId, apiKey: key };
      delete (payload as any).apiKeys;

      const data = await fetchAttempt(payload, 2);
      
      // Clear error state on success
      if (typeof window !== 'undefined') {
        try {
          const errsRaw = localStorage.getItem('gemini_key_errors') || '{}';
          const errs = JSON.parse(errsRaw);
          const baseModel = request.model.replace('models/', '');
          if (errs[key]?.[baseModel]) {
            delete errs[key][baseModel];
            localStorage.setItem('gemini_key_errors', JSON.stringify(errs));
          }
        } catch {}
      }

      // Track usage
      if (typeof window !== 'undefined') {
        const uid = localStorage.getItem('kaktus_user_uid') || localStorage.getItem('kaktus_user_email');
        const estimatedTokens = Math.max(350, Math.ceil((request.systemPrompt.length + JSON.stringify(request.contents).length + (data.text?.length || 0)) / 4));
        const rawTokens = typeof data.usage === 'number' ? data.usage : (data.usage?.totalTokenCount || 0);
        const tokensUsed = rawTokens > 0 ? rawTokens : estimatedTokens;
        recordTokensUsed(uid, key, request.model, tokensUsed);
      }

      return {
        text: data.text || '',
        sources: Array.isArray(data.sources) ? data.sources : [],
        searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries : [],
        researched: data.researched === true,
        taskId: data.taskId || taskId,
        durationMs: data.durationMs,
      };
    } catch (e: unknown) {
      const error = e instanceof AgentRequestError
        ? e
        : new AgentRequestError(e instanceof Error ? e.message : 'Agent request failed.');
      if (error.code === 'APP_QUOTA_EXCEEDED') throw error;
      if (typeof window !== 'undefined') {
        const isProviderLimit = error.code === 'PROVIDER_RATE_LIMIT' || error.code === 'PROVIDER_QUOTA_EXHAUSTED';
        if (isProviderLimit) {
          lastQuotaError = error;
          try {
            const errsRaw = localStorage.getItem('gemini_key_errors') || '{}';
            const errs = JSON.parse(errsRaw);
            if (!errs[key]) errs[key] = {};
            const baseModel = request.model.replace('models/', '');
            errs[key][baseModel] = { type: 'QUOTA_EXHAUSTED', timestamp: Date.now() };
            localStorage.setItem('gemini_key_errors', JSON.stringify(errs));
          } catch {}
        }
      }
      console.warn(`[Smart Handler] Key ending in ${key.slice(-4)} failed for model ${request.model}:`, error.message);
      lastError = error;
    }
  }

  if (triedCount === 0) {
    localStorage.removeItem('gemini_key_errors');
    throw new AgentRequestError('All configured Gemini keys were recently rate-limited. Wait for the provider limit to reset, or try another model.', 'PROVIDER_RATE_LIMIT', 429);
  }

  const finalError = lastQuotaError || lastError;
  throw finalError || new AgentRequestError('Gemini request failed. Please check the configured API key and try again.', 'UPSTREAM_ERROR');
}

export async function listAgentModels(apiKey: string): Promise<Array<{
  name: string;
  version: string;
  displayName: string;
  description: string;
}>> {
  const response = await fetch('/api/models?key=' + encodeURIComponent(apiKey));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not load models.');
  return data.models || [];
}
