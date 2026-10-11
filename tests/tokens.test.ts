import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { 
  getTokenLimit, 
  PLAN_TOKEN_LIMITS, 
  getStoredTokensUsed, 
  recordTokensUsed, 
  isUserQuotaExceeded,
  getTodayDateKey 
} from '../src/lib/tokens';

// Mock localStorage for node environment
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

beforeAll(() => {
  (globalThis as any).window = globalThis;
  (globalThis as any).localStorage = localStorageMock;
  (globalThis as any).CustomEvent = class {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
  (globalThis as any).dispatchEvent = () => true;
});

describe('Token Limits & Usage Blocking Logic', () => {
  const testUid = 'test-user-123';

  beforeEach(() => {
    localStorageMock.clear();
  });

  it('correctly resolves token limits for each plan tier', () => {
    expect(getTokenLimit('free')).toBe(25_000);
    expect(getTokenLimit('starter')).toBe(50_000);
    expect(getTokenLimit('booster')).toBe(75_000);
    expect(getTokenLimit('pro')).toBe(100_000);
    expect(getTokenLimit(null)).toBe(25_000);
    expect(getTokenLimit('unknown')).toBe(25_000);
  });

  it('starts with 0 tokens used for a new user', () => {
    expect(getStoredTokensUsed(testUid)).toBe(0);
    expect(isUserQuotaExceeded(testUid, 'free')).toBe(false);
  });

  it('records tokens and updates total usage correctly', () => {
    const afterFirst = recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 5000);
    expect(afterFirst).toBe(5000);
    expect(getStoredTokensUsed(testUid)).toBe(5000);
    expect(isUserQuotaExceeded(testUid, 'free')).toBe(false);

    const afterSecond = recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 15000);
    expect(afterSecond).toBe(20000);
    expect(getStoredTokensUsed(testUid)).toBe(20000);
    expect(isUserQuotaExceeded(testUid, 'free')).toBe(false);
  });

  it('triggers quota exceeded and blocking when usage reaches or passes limit', () => {
    // Record up to 25,000 for free tier
    recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 25000);
    expect(getStoredTokensUsed(testUid)).toBe(25000);
    expect(isUserQuotaExceeded(testUid, 'free')).toBe(true);

    // But should not exceed starter tier (50k limit)
    expect(isUserQuotaExceeded(testUid, 'starter')).toBe(false);

    // Consume up to starter limit
    recordTokensUsed(testUid, 'key2', 'gemini-3.5-flash', 25000);
    expect(getStoredTokensUsed(testUid)).toBe(50000);
    expect(isUserQuotaExceeded(testUid, 'starter')).toBe(true);
    expect(isUserQuotaExceeded(testUid, 'booster')).toBe(false);
  });

  it('records tokens under today date key', () => {
    recordTokensUsed(testUid, 'server_managed', 'gemini-2.5-flash-lite', 1200);
    const raw = localStorageMock.getItem(`gemini_key_usage_stats_${testUid}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const today = getTodayDateKey();
    expect(parsed[today]).toBeDefined();
    expect(parsed[today]['server_managed']['gemini-2.5-flash-lite']).toBe(1200);
  });
});
