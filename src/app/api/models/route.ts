export const runtime = 'nodejs';

import { getServerApiKey } from '@/lib/server/api-keys';

export async function GET(request: Request) {
  let key = new URL(request.url).searchParams.get('key');
  if (!key || key === 'server_managed' || key === 'default_server_key') {
    const serverKey = await getServerApiKey().catch(() => null);
    key = serverKey || process.env.GEMINI_API_KEY || null;
  }

  if (!key) {
    return Response.json({
      error: 'No active Gemini API key found on server.',
      models: []
    }, { status: 400 });
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
    const data = await response.json().catch(() => ({}));

    if (data.models && Array.isArray(data.models)) {
      const models = data.models
        .filter((model: any) => typeof model.name === 'string' && model.name.includes('gemini') && (model.supportedGenerationMethods || []).includes('generateContent'))
        .map((model: any) => ({
          name: model.name,
          version: model.version || '',
          displayName: model.displayName || model.name.replace('models/', ''),
          description: model.description || '',
        }));
      return Response.json({ models, rawModels: data.models.map((m: any) => m.name) });
    }

    return Response.json({ error: data.error?.message || 'Upstream error', raw: data }, { status: response.status || 502 });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
