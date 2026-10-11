import { apiKeyManager } from './api-key-manager';

/**
 * Adapter for resolving an active Gemini API key from the central ApiKeyManager.
 * Keys never leave the server.
 */
export async function getServerApiKey(): Promise<string | null> {
  const keys = await getServerApiKeys();
  return keys.length > 0 ? keys[0] : null;
}

export async function getServerApiKeys(): Promise<string[]> {
  const keys = await apiKeyManager.getKeys();
  const eligible = keys.filter(k => k.enabled && k.status !== 'disabled');
  const result: string[] = eligible.map(k => k.key);
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    const envKey = process.env.GEMINI_API_KEY.trim();
    if (!result.includes(envKey)) {
      result.unshift(envKey);
    }
  }
  return result;
}
