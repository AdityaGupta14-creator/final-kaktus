import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { 
  getTokenLimit, 
  PLAN_TOKEN_LIMITS, 
  getStoredTokensUsed, 
  recordTokensUsed, 
  isUserQuotaExceeded,
  getTodayDateKey,
  isPlanExpired,
  getEffectiveUserPlan,
  checkAndResetDailyTokens,
  getTimeUntilMidnight
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
    expect(getTokenLimit('free')).toBe(75_000);
    expect(getTokenLimit('starter')).toBe(165_000);
    expect(getTokenLimit('booster')).toBe(255_000);
    expect(getTokenLimit('pro')).toBe(335_000);
    expect(getTokenLimit(null)).toBe(75_000);
    expect(getTokenLimit('unknown')).toBe(75_000);
  });

  it('reverts to free plan limit (75k) once planExpiresAt has passed', () => {
    const expiredDate = new Date(Date.now() - 60_000); // Expired 1 minute ago
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week in future

    expect(isPlanExpired(expiredDate)).toBe(true);
    expect(isPlanExpired(futureDate)).toBe(false);

    // Expired starter plan reverts to free limit
    expect(getEffectiveUserPlan('starter', expiredDate)).toBe('free');
    expect(getTokenLimit('starter', expiredDate)).toBe(75_000);

    // Active starter plan retains 165k limit
    expect(getEffectiveUserPlan('starter', futureDate)).toBe('starter');
    expect(getTokenLimit('starter', futureDate)).toBe(165_000);

    // Expired pro plan reverts to free limit
    expect(getTokenLimit('pro', expiredDate)).toBe(75_000);
    // Active pro plan gets 335k
    expect(getTokenLimit('pro', futureDate)).toBe(335_000);
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

  it('calculates time until 12:00 AM midnight', () => {
    const untilMidnight = getTimeUntilMidnight();
    expect(untilMidnight.ms).toBeGreaterThan(0);
    expect(untilMidnight.hours).toBeGreaterThanOrEqual(0);
    expect(untilMidnight.hours).toBeLessThanOrEqual(24);
    expect(untilMidnight.formatted).toBeTruthy();
  });

  it('handles daily midnight rollover check correctly', () => {
    const today = getTodayDateKey();
    // First run registers today's date
    const resetTriggered = checkAndResetDailyTokens(testUid);
    expect(resetTriggered).toBe(true);
    expect(localStorageMock.getItem(`kaktus_last_daily_token_reset_${testUid}`)).toBe(today);

    // Consecutive run on same day returns false
    const secondRun = checkAndResetDailyTokens(testUid);
    expect(secondRun).toBe(false);
  });
});
