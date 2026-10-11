import type { ImageAttachment } from './image-attachments';
import { getTokenLimit, getStoredTokensUsed, recordTokensUsed } from '@/lib/tokens';

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
}

interface AgentRequest {
  apiKeys: string[];
  model: string;
  systemPrompt: string;
  contents: AgentMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  research?: boolean;
  abortSignal?: AbortSignal;
}

/**
 * Smart key ordering: puts billing-enabled keys (labeled "payed" or "paid" in admin)
 * LAST so they act as a guaranteed fallback. Free keys are shuffled and tried first.
 */
function getOrderedKeys(keys: string[]): string[] {
  if (keys.length <= 1) return keys;

  let billingKeys: string[] = [];
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
  // Check token limits before making the request
  if (typeof window !== 'undefined') {
    const uid = localStorage.getItem('kaktus_user_uid') || localStorage.getItem('kaktus_user_email');
    const plan = (localStorage.getItem('kaktus_user_plan') || 'free').toLowerCase();
    const planExpiresAt = localStorage.getItem('kaktus_user_plan_expires_at');
    const limit = getTokenLimit(plan, planExpiresAt);
    const currentTotal = getStoredTokensUsed(uid);
    
    if (currentTotal >= limit) {
      window.dispatchEvent(new CustomEvent('geminiQuotaExceeded', { detail: { currentTotal, limit } }));
      throw new Error(`Daily Quota Reached. You have exceeded your ${limit / 1000}k tokens daily limit. Please upgrade your plan to continue.`);
    }
  }

  if (!request.apiKeys || request.apiKeys.length === 0) {
    const payload = { ...request, apiKey: 'default_server_key' };
    delete (payload as any).apiKeys;

    if (request.abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Agent request failed');

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
    };
  }

  const orderedKeys = typeof window !== 'undefined' 
    ? getOrderedKeys(request.apiKeys) 
    : [...request.apiKeys];
  
  let lastError: any = null;
  let lastQuotaError: any = null;
  let triedCount = 0;

  for (const key of orderedKeys) {
    if (typeof window !== 'undefined' && isKeyRecentlyExhausted(key, request.model)) {
      console.log(`[Smart Handler] Skipping recently exhausted key ...${key.slice(-4)}`);
      continue;
    }

    triedCount++;

    try {
      const payload = { ...request, apiKey: key };
      delete (payload as any).apiKeys;

      const response = await fetch('/api/agent', {
        signal: request.abortSignal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        const errorMsg = data.error || 'Agent request failed.';
        
        if (typeof window !== 'undefined') {
          const isQuota = response.status === 429 || (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('quota'));
          if (isQuota) {
            lastQuotaError = new Error(errorMsg);
            const errsRaw = localStorage.getItem('gemini_key_errors') || '{}';
            const errs = JSON.parse(errsRaw);
            if (!errs[key]) errs[key] = {};
            
            const baseModel = request.model.replace('models/', '');
            errs[key][baseModel] = { type: 'QUOTA_EXHAUSTED', timestamp: Date.now() };
            localStorage.setItem('gemini_key_errors', JSON.stringify(errs));
          }
        }
        
        throw new Error(errorMsg);
      }
      
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
      };
    } catch (e: any) {
      console.warn(`[Smart Handler] Key ending in ${key.slice(-4)} failed for model ${request.model}:`, e.message);
      lastError = e;
    }
  }

  if (triedCount === 0) {
    localStorage.removeItem('gemini_key_errors');
    throw new Error('All keys were recently rate-limited. Please wait a moment and try again.');
  }

  const finalError = lastQuotaError || lastError;
  throw new Error(`All keys failed. Last error: ${finalError?.message || 'Gemini request failed. Please check your keys or quota.'}`);
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
