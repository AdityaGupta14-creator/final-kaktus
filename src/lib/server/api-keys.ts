import { apiKeyManager } from './api-key-manager';

/**
 * Adapter for resolving an active Gemini API key from the central ApiKeyManager.
 * Keys never leave the server.
 */
export async function getServerApiKey(): Promise<string | null> {
  const keys = await getServerApiKeys();
  return keys.length > 0 ? keys[0] : null;
}

export interface ServerCandidateKeyInfo {
  id: string;
  label: string;
  source: 'environment' | 'Firestore';
  maskedKey: string;
  key: string;
}

export async function getServerCandidateKeyRecords(): Promise<ServerCandidateKeyInfo[]> {
  const keys = await apiKeyManager.getKeys();
  const eligible = keys.filter(k => k.enabled && k.status !== 'disabled');
  const records: ServerCandidateKeyInfo[] = eligible.map(k => ({
    id: k.id,
    label: k.label,
    source: k.id === 'env_primary_gemini' ? ('environment' as const) : ('Firestore' as const),
    maskedKey: k.maskedKey,
    key: k.key,
  }));

  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    const envKey = process.env.GEMINI_API_KEY.trim();
    if (!records.some(r => r.key === envKey)) {
      records.unshift({
        id: 'env_primary_gemini',
        label: 'Primary Environment Key',
        source: 'environment',
        maskedKey: envKey.length > 6 ? `••••${envKey.slice(-4)}` : '••••••••',
        key: envKey,
      });
    }
  }

  return records;
}

export async function getServerApiKeys(): Promise<string[]> {
  const records = await getServerCandidateKeyRecords();
  return records.map(r => r.key);
}


