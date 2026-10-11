export const runtime = 'nodejs';

export const DEFAULT_MODELS = [
  {
    name: 'models/gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    version: '2.5',
    description: 'Fast, lightweight model for everyday circuit inquiries',
  },
  {
    name: 'models/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    version: '2.5',
    description: 'Balanced performance for electronics prototyping & debugging',
  },
  {
    name: 'models/gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    version: '3.5',
    description: 'Next-generation rapid response hardware copilot',
  },
  {
    name: 'models/gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    version: '3.5',
    description: 'High reasoning capabilities for complex multi-chip circuit design',
  },
  {
    name: 'models/gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    version: '3.6',
    description: 'Multimodal schematic, PCB analysis & firmware synthesis',
  },
  {
    name: 'models/gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    version: '3.7',
    description: 'State of the art hardware verification & electrical design',
  },
  {
    name: 'models/gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    version: '3.8',
    description: 'Ultimate engineering intelligence for deep system design',
  },
];

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');

  // If no key or server-managed placeholder, return standard Kaktus models
  if (!key || key === 'server_managed' || key === 'default_server_key') {
    return Response.json({ models: DEFAULT_MODELS });
  }

  // If a custom API key was passed, attempt to fetch from Google, but always fall back cleanly
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
    const data = await response.json().catch(() => ({}));

    if (response.ok && Array.isArray(data.models) && data.models.length > 0) {
      const fetched = data.models
        .filter((model: any) => typeof model.name === 'string' && model.name.includes('gemini') && (model.supportedGenerationMethods || []).includes('generateContent'))
        .map((model: any) => ({
          name: model.name,
          version: model.version || '',
          displayName: model.displayName || model.name.replace('models/', ''),
          description: model.description || '',
        }));

      const existingNames = new Set(fetched.map((m: any) => m.name));
      const combined = [...DEFAULT_MODELS.filter(m => !existingNames.has(m.name)), ...fetched];
      return Response.json({ models: combined });
    }
  } catch (err) {
    console.warn('[ModelsRoute] Error fetching models from Google upstream:', err);
  }

  return Response.json({ models: DEFAULT_MODELS });
}
