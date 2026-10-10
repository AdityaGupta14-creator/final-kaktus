import type { ImageAttachment } from './image-attachments';

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

export async function requestAgent(request: AgentRequest): Promise<AgentResponse> {
  // Check token limits before making the request
  if (typeof window !== 'undefined') {
    const uid = localStorage.getItem('kaktus_user_uid');
    if (uid) {
      const usageRaw = localStorage.getItem(`gemini_key_usage_stats_${uid}`);
    if (usageRaw) {
      try {
        const usageObj = JSON.parse(usageRaw);
        let currentTotal = 0;
        const today = new Date().toISOString().substring(0, 16); // format: YYYY-MM-DDTHH:mm (resets every minute)
        if (usageObj[today]) {
          for (const key in usageObj[today]) {
            for (const model in usageObj[today][key]) {
              currentTotal += usageObj[today][key][model];
            }
          }
        }
        const plan = localStorage.getItem('kaktus_user_plan') || 'free';
        const limit = plan === 'free' ? 5000000 : 20000000; // Reset limit: raised to 5M for free tier testing
        
        if (currentTotal >= limit) {
          throw new Error(`Daily Quota Reached. You have exceeded your ${limit / 1000}k tokens limit. Please upgrade your plan to continue.`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('Quota Reached')) {
          throw e;
        }
      }
    }
    }
  }

  if (!request.apiKeys || request.apiKeys.length === 0) {
    // Fallback to server-side default API key
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
    return data;
  }

  // Shuffle keys for load balancing
  const keys = [...request.apiKeys].sort(() => Math.random() - 0.5);
  let lastError: any = null;

  for (const key of keys) {
    try {
      const payload = { ...request, apiKey: key };
      // Remove apiKeys array from payload to avoid sending it to the server unnecessary
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
        
        // Track exhaustion
        if (typeof window !== 'undefined') {
          const isQuota = response.status === 429 || (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('quota'));
          if (isQuota) {
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
      
      // Track usage
      try {
        if (typeof window !== 'undefined') {
          const uid = localStorage.getItem('kaktus_user_uid');
          if (uid) {
            const today = new Date().toISOString().substring(0, 16); // 1-minute reset for testing
            const usageRaw = localStorage.getItem(`gemini_key_usage_stats_${uid}`) || '{}';
            const usage = JSON.parse(usageRaw);
            if (!usage[today]) usage[today] = {};
            if (!usage[today][key]) usage[today][key] = {};
            
            const baseModel = request.model.replace('models/', '');
            if (!usage[today][key][baseModel]) usage[today][key][baseModel] = 0;
            
            const tokensUsed = typeof data.usage === 'number' ? data.usage : 0;
            usage[today][key][baseModel] += tokensUsed;
            
            localStorage.setItem(`gemini_key_usage_stats_${uid}`, JSON.stringify(usage));
            window.dispatchEvent(new Event('geminiUsageUpdated'));
          }
        }
      } catch(e) {
        console.error("Failed to track usage", e);
      }

      // Success! Return the text
      return {
        text: data.text || '',
        sources: Array.isArray(data.sources) ? data.sources : [],
        searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries : [],
        researched: data.researched === true,
      };
    } catch (e: any) {
      console.warn(`[Smart Handler] Key ending in ${key.slice(-4)} failed for model ${request.model}:`, e.message);
      lastError = e;
      // Continue to the next key...
    }
  }

  // If all keys failed, throw the last error we got
  throw new Error(`All keys failed. Last error: ${lastError?.message || 'Unknown error'}`);
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
