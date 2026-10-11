export const runtime = 'nodejs';

import { getServerApiKey, getServerApiKeys } from '@/lib/server/api-keys';

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

  // Resolve API Key: gather candidate keys
  const candidateKeys: string[] = [];
  const directKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

  if (directKey && directKey !== 'server_managed' && directKey !== 'default_server_key') {
    candidateKeys.push(directKey);
  }

  try {
    const serverKeys = await getServerApiKeys();
    serverKeys.forEach(k => {
      if (!candidateKeys.includes(k)) candidateKeys.push(k);
    });
  } catch (err) {
    console.warn('[AgentRoute] Could not get server keys from manager:', err);
  }

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    const envKey = process.env.GEMINI_API_KEY.trim();
    if (!candidateKeys.includes(envKey)) candidateKeys.push(envKey);
  }

  if (candidateKeys.length === 0) {
    return Response.json({
      error: 'No active Gemini API key found. Please add a Gemini key in the Admin Panel or set GEMINI_API_KEY.',
    }, { status: 503 });
  }

  const rawModel = body.model.startsWith('models/') ? body.model : `models/${body.model}`;
  let primaryModel = rawModel;
  if (rawModel.includes('2.5-flash-lite')) {
    primaryModel = 'models/gemini-3.5-flash-lite';
  } else if (rawModel.includes('2.5-flash')) {
    primaryModel = 'models/gemini-3.5-flash';
  }

  // Prioritize requested model with fallback to healthy active engines
  const candidateModels = [
    primaryModel,
    'models/gemini-3.5-flash',
    'models/gemini-3.5-flash-lite',
    'models/gemini-flash-latest',
  ];
  const uniqueCandidateModels = Array.from(new Set(candidateModels));

  let lastResponse: Response | null = null;
  let lastResult: GeminiResponse = {};

  // Try candidate keys in pool
  for (const activeApiKey of candidateKeys) {
    for (const modelToTry of uniqueCandidateModels) {
      try {
        const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/' + modelToTry + ':generateContent?key=' + encodeURIComponent(activeApiKey), {
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
        lastResponse = upstream;
        lastResult = result;

        // If model not found (404) or temporarily overloaded (503), try next active candidate
        if (upstream.status === 404 || upstream.status === 503) {
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
          return Response.json({ text, sources, searchQueries, researched: body.research === true && sources.length > 0, usage });
        }

        // If quota exceeded or auth failure on this key, try NEXT key in candidate pool!
        if (upstream.status === 401 || upstream.status === 429) {
          console.warn(`[AgentRoute] Key ending in ${activeApiKey.slice(-4)} failed with status ${upstream.status}. Trying next key...`);
          break;
        }
      } catch (fetchErr) {
        console.warn('[AgentRoute] Upstream fetch error for model:', modelToTry, fetchErr);
      }
    }
  }

  return Response.json({
    error: lastResult?.error?.message || 'Gemini request failed.',
  }, { status: lastResponse?.status || 502 });
}

export async function GET() {
  return Response.json({ ok: true, service: 'Hardware Studio Agent Gateway' });
}
