import { describe, it, expect, afterEach } from 'vitest';
import { getServerCandidateKeyRecords } from '@/lib/server/api-keys';
import { apiKeyManager } from '@/lib/server/api-key-manager';

describe('Gemini Key Resolution & Priority Flow', () => {
  const originalEnvKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.GEMINI_API_KEY = originalEnvKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    apiKeyManager.invalidateCache();
  });

  it('places GEMINI_API_KEY first as env_primary_gemini with source environment', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyD_TestEnvKey1234567890';
    apiKeyManager.invalidateCache();

    const candidates = await getServerCandidateKeyRecords();
    expect(candidates.length).toBeGreaterThan(0);
    
    // First candidate must be the environment key
    const primary = candidates[0];
    expect(primary.id).toBe('env_primary_gemini');
    expect(primary.source).toBe('environment');
    expect(primary.label).toBe('Primary Environment Key');
    expect(primary.maskedKey).toBe('••••••••7890');
    expect(primary.key).toBe('AIzaSyD_TestEnvKey1234567890');
  });

  it('includes Firestore pool keys after the primary environment key as fallback candidates', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyD_TestEnvKey1234567890';
    apiKeyManager.invalidateCache();

    const candidates = await getServerCandidateKeyRecords();
    
    // If pool keys exist, they must follow with source Firestore
    if (candidates.length > 1) {
      const fallbackCandidates = candidates.slice(1);
      for (const fb of fallbackCandidates) {
        expect(fb.source).toBe('Firestore');
        expect(fb.id).not.toBe('env_primary_gemini');
        expect(fb.maskedKey).toMatch(/^••••/);
      }
    }
  });

  it('falls back entirely to Firestore keys when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    apiKeyManager.invalidateCache();

    const candidates = await getServerCandidateKeyRecords();
    // All candidates must be from Firestore
    for (const c of candidates) {
      expect(c.source).toBe('Firestore');
      expect(c.id).not.toBe('env_primary_gemini');
    }
  });

  it('executes a real minimal Gemini generation request and returns safe diagnostic metadata', async () => {
    // When GEMINI_API_KEY is unset, it uses the Firestore pool
    delete process.env.GEMINI_API_KEY;
    apiKeyManager.invalidateCache();

    const { POST } = await import('@/app/api/agent/route');
    const req = new Request('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-3.5-flash',
        systemPrompt: 'You are a test ping agent. Answer with exactly the word: PONG',
        contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.text).toBeDefined();
    expect(typeof data.text).toBe('string');
    expect(data.keyDiagnostic).toBeDefined();
    expect(data.keyDiagnostic.source).toBe('Firestore');
    expect(data.keyDiagnostic.id).toBeDefined();
    expect(data.keyDiagnostic.maskedKey).toMatch(/^••••/);
    console.log('[Test Diagnostics Output]:', JSON.stringify(data.keyDiagnostic, null, 2));
  }, 15000);

  it('selects environment key when GEMINI_API_KEY is valid and reports source=environment', async () => {
    // Verify that if GEMINI_API_KEY is set to a functional key, it selects it first
    // Use the first active key from pool as the test environment key to test real upstream generation
    const candidates = await getServerCandidateKeyRecords();
    const activeKey = candidates.find(c => c.source === 'Firestore' && c.key);
    if (!activeKey) return;

    process.env.GEMINI_API_KEY = activeKey.key;
    apiKeyManager.invalidateCache();

    const { POST } = await import('@/app/api/agent/route');
    const req = new Request('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-3.5-flash',
        systemPrompt: 'You are a test ping agent. Answer with the word: PONG',
        contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.keyDiagnostic.source).toBe('environment');
    expect(data.keyDiagnostic.id).toBe('env_primary_gemini');
    expect(data.keyDiagnostic.label).toBe('Primary Environment Key');
    console.log('[Environment Key Test Diagnostic]:', JSON.stringify(data.keyDiagnostic, null, 2));
  }, 15000);

  it('falls back to Firestore keys if GEMINI_API_KEY fails with an authentication error', async () => {
    // Set a deliberately invalid environment key
    process.env.GEMINI_API_KEY = 'AIzaSyD_InvalidMockKeyThatWillFail400';
    apiKeyManager.invalidateCache();

    const { POST } = await import('@/app/api/agent/route');
    const req = new Request('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-3.5-flash',
        systemPrompt: 'You are a test ping agent.',
        contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    // It should have caught the invalid env key, logged it, and fallen back to Firestore!
    expect(data.keyDiagnostic.source).toBe('Firestore');
    expect(data.keyDiagnostic.id).not.toBe('env_primary_gemini');
    console.log('[Fallback Test Diagnostic]: Successfully fell back to Firestore key:', JSON.stringify(data.keyDiagnostic, null, 2));
  }, 20000);
});

