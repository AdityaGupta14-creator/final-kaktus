import { apiKeyManager } from './api-key-manager';

/**
 * Adapter for resolving an active Gemini API key from the central ApiKeyManager.
 * Keys never leave the server.
 */
export async function getServerApiKey(): Promise<string | null> {
  const keys = await apiKeyManager.getKeys();
  const eligible = keys.filter(k => k.enabled && k.status !== 'disabled');
  return eligible.length > 0 ? eligible[0].key : null;
}
