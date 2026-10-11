export const runtime = 'nodejs';

import { getServerApiKey } from '@/lib/server/api-keys';

export async function GET(request: Request) {
  const key = await getServerApiKey().catch(() => null) || process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'No key' });

  const testModels = [
    'models/gemini-2.5-flash',
    'models/gemini-2.5-pro',
    'models/gemini-2.5-flash-lite',
    'models/gemini-1.5-flash',
    'models/gemini-1.5-pro',
    'models/gemini-flash-latest',
    'models/gemini-3.5-flash',
  ];

  const results: any[] = [];
  for (const m of testModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${m}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
        })
      });
      const data = await res.json().catch(() => ({}));
      results.push({
        model: m,
        status: res.status,
        ok: res.ok,
        error: data.error,
        candidateSample: data.candidates?.[0]?.content?.parts?.[0]?.text
      });
    } catch (e: any) {
      results.push({ model: m, error: e.message });
    }
  }

  return Response.json({ results });
}
