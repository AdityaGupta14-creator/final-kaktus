export const runtime = 'nodejs';
 
import { getServerCandidateKeyRecords, type ServerCandidateKeyInfo } from '@/lib/server/api-keys';
import { extractBearerToken } from '@/lib/server/auth';
import { verifyUserToken } from '@/lib/server/firebase-admin';
import { recordApiUsage } from '@/lib/server/usage-meter';
import { classifyProviderError } from '@/lib/server/api-key-manager';

const MAX_BODY_BYTES = 1_500_000;
const MODEL_PATTERN = /^(?:models\/)?gemini-[a-zA-Z0-9._-]+$/;

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface GeminiResponse {
  error?: { message?: string; code?: number };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function POST(request: Request) {
  const startTime = Date.now();
  let callerUid: string | null = null;
  const token = extractBearerToken(request);
  if (token) {
    try {
      const user = await verifyUserToken(token);
      if (user) callerUid = user.uid;
    } catch {
      // Proceed anonymously if token fails verification
    }
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request is too large.' }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return Response.json({ error: 'Request body must be an object.' }, { status: 400 });
    body = parsed;
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }


  if (!validText(body.model, 160) || !MODEL_PATTERN.test(body.model)) {
    return Response.json({ error: 'A valid Gemini model identifier is required.' }, { status: 400 });
  }
  if (!validText(body.systemPrompt, 600_000) || !Array.isArray(body.contents) || body.contents.length > 80) {
    return Response.json({ error: 'Invalid agent context.' }, { status: 400 });
  }

  // Resolve API Key: gather candidate keys with diagnostic metadata
  const candidateKeys: ServerCandidateKeyInfo[] = [];
  const directKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

  if (directKey && directKey !== 'server_managed' && directKey !== 'default_server_key') {
    candidateKeys.push({
      id: 'direct_client_key',
      label: 'Direct Client Key',
      source: 'direct' as any,
      maskedKey: directKey.length > 6 ? `••••${directKey.slice(-4)}` : '••••••••',
      key: directKey,
    });
  }

  try {
    const serverRecords = await getServerCandidateKeyRecords();
    for (const rec of serverRecords) {
      if (!candidateKeys.some(k => k.key === rec.key)) {
        candidateKeys.push(rec);
      }
    }
  } catch (err) {
    console.warn('[AgentRoute] Could not get server keys from manager:', err);
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    const envKey = process.env.GEMINI_API_KEY.trim();
    if (!candidateKeys.some(k => k.key === envKey)) {
      candidateKeys.unshift({
        id: 'env_primary_gemini',
        label: 'Primary Environment Key',
        source: 'environment',
        maskedKey: envKey.length > 6 ? `••••${envKey.slice(-4)}` : '••••••••',
        key: envKey,
      });
    }
  }

  if (candidateKeys.length === 0) {
    return Response.json({
      error: 'No active Gemini API key found. Please add a Gemini key in the Admin Panel or set GEMINI_API_KEY.',
    }, { status: 503 });
  }

  const rawModel = (typeof body.model === 'string' ? body.model : '').replace(/^models\//, '').toLowerCase();
  const requestedModel = 'models/' + rawModel;
  let fallbackModel = 'models/gemini-2.0-flash';
  if (rawModel.includes('flash-lite') || rawModel.includes('lite')) {
    fallbackModel = 'models/gemini-2.0-flash-lite';
  } else {
    fallbackModel = 'models/gemini-2.0-flash';
  }

  // Real model candidates with seamless fallback to active Gemini 3.x models
  const candidateModels = [
    requestedModel,
    'models/gemini-3.5-flash',
    'models/gemini-3.8-flash',
    fallbackModel,
    'models/gemini-2.0-flash',
    'models/gemini-2.0-flash-lite',
  ];
  const uniqueCandidateModels = Array.from(new Set(candidateModels));

  let lastQuotaError: { message: string; status: number } | null = null;
  let lastAuthError: { message: string; status: number } | null = null;
  let lastGeneralError: { message: string; status: number } | null = null;

  // Try candidate keys in pool
  for (const candidate of candidateKeys) {
    let keyQuotaBilledExhausted = false;
    for (const modelToTry of uniqueCandidateModels) {
      if (keyQuotaBilledExhausted) break;
      try {
        const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/' + modelToTry + ':generateContent?key=' + encodeURIComponent(candidate.key), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: body.systemPrompt }] },
            contents: body.contents,
            ...(body.research === true ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: {
              temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1) : 0.2,
              maxOutputTokens: typeof body.maxOutputTokens === 'number' ? Math.min(Math.max(body.maxOutputTokens, 256), 32768) : 16384,
              responseMimeType: 'text/plain',
            },
          }),
        });

        const result: GeminiResponse = await upstream.json().catch((): GeminiResponse => ({}));

        // If model not found (404), skip it immediately without overwriting last error
        if (upstream.status === 404) {
          continue;
        }

        if (upstream.ok && !result.error) {
          const text = result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
          const grounding = result.candidates?.[0]?.groundingMetadata;
          const sources = Array.isArray(grounding?.groundingChunks)
            ? grounding.groundingChunks.flatMap(chunk => chunk.web?.uri && chunk.web?.title
              ? [{ title: chunk.web.title.slice(0, 240), uri: chunk.web.uri }]
              : []).filter((source: { uri: string }, index: number, all: { uri: string }[]) => all.findIndex(item => item.uri === source.uri) === index).slice(0, 20)
            : [];
          const searchQueries = Array.isArray(grounding?.webSearchQueries) ? grounding.webSearchQueries.slice(0, 12) : [];
          const usage = result.usageMetadata?.totalTokenCount || 0;
          const inputTokens = result.usageMetadata?.promptTokenCount || 0;
          const outputTokens = result.usageMetadata?.candidatesTokenCount || 0;

          // Safe diagnostic log (never logs plaintext keys)
          console.log(`[AgentRoute] Request succeeded with model ${modelToTry} using key [id="${candidate.id}", label="${candidate.label}", source="${candidate.source}"]`);

          if (callerUid) {
            recordApiUsage({
              uid: callerUid,
              endpoint: '/api/agent',
              provider: 'Gemini',
              model: modelToTry,
              timestamp: new Date().toISOString(),
              success: true,
              failure: false,
              durationMs: Date.now() - startTime,
              inputTokens,
              outputTokens,
              totalTokens: usage,
              keyId: candidate.id,
            }).catch(err => console.warn('[AgentRoute] Failed to record usage:', err));
          }

          return Response.json({
            text,
            sources,
            searchQueries,
            researched: body.research === true && sources.length > 0,
            usage,
            keyDiagnostic: {
              id: candidate.id,
              label: candidate.label,
              source: candidate.source,
              maskedKey: candidate.maskedKey,
              modelUsed: modelToTry,
            },
          });
        }

        const errMsg = (result.error?.message || '').toLowerCase();
        const isQuotaHit = upstream.status === 429 || errMsg.includes('quota') || errMsg.includes('resource_exhausted');

        if (isQuotaHit) {
          console.warn(`[AgentRoute] Model ${modelToTry} quota hit on key [id="${candidate.id}", source="${candidate.source}"]: ${result.error?.message}`);
          lastQuotaError = {
            message: result.error?.message || 'You exceeded your current quota, please check your plan and billing details.',
            status: 429,
          };
          if (errMsg.includes('exceeded your current quota') || errMsg.includes('billing')) {
            // Entire key billing quota exhausted, switch to next key immediately
            keyQuotaBilledExhausted = true;
            break;
          }
          continue;
        }

        // If auth failure on this key (401 / 403), record and break to try next key in pool
        if (upstream.status === 401 || (upstream.status === 403 && (errMsg.includes('api key') || errMsg.includes('credential')))) {
          console.warn(`[AgentRoute] Key [id="${candidate.id}", source="${candidate.source}"] failed with auth error ${upstream.status}. Falling back to next key...`);
          lastAuthError = {
            message: result.error?.message || 'Invalid Gemini API key or credentials.',
            status: upstream.status,
          };
          break;
        }

        if (result.error?.message) {
          lastGeneralError = {
            message: result.error.message,
            status: upstream.status,
          };
        }
      } catch (fetchErr) {
        console.warn('[AgentRoute] Upstream fetch error for model:', modelToTry, fetchErr);
      }
    }
  }

  // Prioritize returning quota error if all keys were exhausted so UI can trigger plan upgrade
  const finalError = lastQuotaError || lastGeneralError || lastAuthError;

  if (callerUid) {
    const errorType = lastQuotaError ? 'quota_exceeded' : lastAuthError ? 'auth_error' : 'request_error';
    recordApiUsage({
      uid: callerUid,
      endpoint: '/api/agent',
      provider: 'Gemini',
      model: rawModel || 'gemini-model',
      timestamp: new Date().toISOString(),
      success: false,
      failure: true,
      errorType,
      durationMs: Date.now() - startTime,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      keyId: 'all_exhausted',
    }).catch(err => console.warn('[AgentRoute] Failed to record failure usage:', err));
  }

  return Response.json({
    error: finalError?.message || 'Gemini request failed. Please check your keys or quota.',
  }, { status: finalError?.status || 502 });
}

export async function GET() {
  return Response.json({ ok: true, service: 'Hardware Studio Agent Gateway' });
}
