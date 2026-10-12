import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  getTokenLimit,
  isUnlimitedQuota,
  isUserQuotaExceeded,
  recordTokensUsed,
  getStoredTokensUsed,
  TEST_HIGH_TOKEN_LIMIT
} from '../src/lib/tokens';
import {
  hasAdminRole,
  canAssignRoles,
  canAccessAdminDashboard,
  canManageApiKeys,
  canManagePayments,
  isAssignableRole,
  isValidTestQuotaMode,
  isTestRole,
  VALID_ROLES,
  UserRole
} from '../src/lib/server/roles';
import { resolveUserRole } from '../src/lib/server/firebase-admin';

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

describe('TEST Role & Quota Allowance Regression Suite', () => {
  const normalUid = 'normal-user-123';
  const testUid = 'test-internal-user-456';

  beforeEach(() => {
    localStorageMock.clear();
  });

  // 1. Existing USER quota behavior remains unchanged
  it('1. maintains existing USER quota limits across free/starter/booster/pro', () => {
    expect(getTokenLimit('free', null, 'USER')).toBe(25_000);
    expect(getTokenLimit('starter', null, 'USER')).toBe(50_000);
    expect(getTokenLimit('booster', null, 'USER')).toBe(75_000);
    expect(getTokenLimit('pro', null, 'USER')).toBe(100_000);
    
    // Normal user with 30k used exceeds free plan
    recordTokensUsed(normalUid, 'key1', 'gemini-2.5-flash', 30_000);
    expect(isUserQuotaExceeded(normalUid, 'free', null, 'USER')).toBe(true);
  });

  // 2. TEST with STANDARD mode follows normal quota rules
  it('2. enforces normal plan quota rules for TEST accounts in STANDARD mode', () => {
    const limit = getTokenLimit('free', null, 'TEST', 'STANDARD');
    expect(limit).toBe(25_000);
    expect(isUnlimitedQuota('TEST', 'STANDARD')).toBe(false);

    recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 26_000);
    expect(isUserQuotaExceeded(testUid, 'free', null, 'TEST', 'STANDARD')).toBe(true);
  });

  // 3. TEST with HIGH mode can exceed regular user's quota up to configured allowance
  it('3. allows TEST account with HIGH mode to exceed normal quota up to 500,000 tokens', () => {
    const limit = getTokenLimit('free', null, 'TEST', 'HIGH');
    expect(limit).toBe(TEST_HIGH_TOKEN_LIMIT);
    expect(limit).toBe(500_000);
    expect(isUnlimitedQuota('TEST', 'HIGH')).toBe(false);

    // Consume 100,000 tokens (would block any normal user)
    recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 100_000);
    expect(isUserQuotaExceeded(testUid, 'free', null, 'TEST', 'HIGH')).toBe(false);

    // Consume up to 500,001 tokens
    recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 400_001);
    expect(getStoredTokensUsed(testUid)).toBe(500_001);
    expect(isUserQuotaExceeded(testUid, 'free', null, 'TEST', 'HIGH')).toBe(true);
  });

  // 4. TEST with UNLIMITED mode is not blocked by standard token limits
  it('4. ensures TEST account with UNLIMITED mode is not blocked by any application token limit', () => {
    const limit = getTokenLimit('free', null, 'TEST', 'UNLIMITED');
    expect(limit).toBe(Number.POSITIVE_INFINITY);
    expect(isUnlimitedQuota('TEST', 'UNLIMITED')).toBe(true);

    // Record millions of tokens
    recordTokensUsed(testUid, 'key1', 'gemini-2.5-flash', 5_000_000);
    expect(getStoredTokensUsed(testUid)).toBe(5_000_000);
    // Never blocked by application quota
    expect(isUserQuotaExceeded(testUid, 'free', null, 'TEST', 'UNLIMITED')).toBe(false);
  });

  // 5. UNLIMITED representation is explicit, not an arbitrary integer overflow
  it('5. explicitly represents UNLIMITED without number overflow or arbitrary magic numbers', () => {
    expect(isUnlimitedQuota('TEST', 'UNLIMITED')).toBe(true);
    expect(isUnlimitedQuota('TEST', 'HIGH')).toBe(false);
    expect(isUnlimitedQuota('USER', 'UNLIMITED')).toBe(false); // Only TEST role can have UNLIMITED
    expect(getTokenLimit('free', null, 'TEST', 'UNLIMITED')).toBe(Number.POSITIVE_INFINITY);
  });

  // 6. Security & Privilege Separation: TEST role does NOT inherit admin permissions
  it('6. strictly separates TEST from administrative privileges', () => {
    expect(hasAdminRole('TEST')).toBe(false);
    expect(canAssignRoles('TEST')).toBe(false);
    expect(canAccessAdminDashboard('TEST')).toBe(false);
    expect(canManageApiKeys('TEST')).toBe(false);
    expect(canManagePayments('TEST')).toBe(false);

    // Contrast with ADMIN and SUPER_ADMIN
    expect(hasAdminRole('ADMIN')).toBe(true);
    expect(hasAdminRole('SUPER_ADMIN')).toBe(true);
    expect(canAssignRoles('SUPER_ADMIN')).toBe(true);
    expect(canAssignRoles('ADMIN')).toBe(false);
  });

  // 7. Role validity and assignability
  it('7. recognizes TEST as a valid assignable role alongside existing roles', () => {
    expect(VALID_ROLES).toContain('TEST');
    expect(isAssignableRole('TEST')).toBe(true);
    expect(isAssignableRole('USER')).toBe(true);
    expect(isAssignableRole('ADMIN')).toBe(true);
    expect(isAssignableRole('SUPER_ADMIN')).toBe(true);

    // Legacy roles cannot be newly assigned
    expect(isAssignableRole('FINANCE')).toBe(false);
    expect(isAssignableRole('SUPPORT')).toBe(false);
    expect(isAssignableRole('HACKER')).toBe(false);
  });

  // 8. Quota mode validation
  it('8. validates quota modes strictly', () => {
    expect(isValidTestQuotaMode('STANDARD')).toBe(true);
    expect(isValidTestQuotaMode('HIGH')).toBe(true);
    expect(isValidTestQuotaMode('UNLIMITED')).toBe(true);
    expect(isValidTestQuotaMode('INVALID')).toBe(false);
    expect(isValidTestQuotaMode(null)).toBe(false);
    expect(isValidTestQuotaMode(undefined)).toBe(false);
    expect(isValidTestQuotaMode(999999)).toBe(false);
  });

  // 9. Fail-safe role resolution
  it('9. resolves missing or invalid custom claims safely to USER', () => {
    expect(resolveUserRole(null)).toBe('USER');
    expect(resolveUserRole({})).toBe('USER');
    expect(resolveUserRole({ role: 'INVALID_ROLE' })).toBe('USER');
    expect(resolveUserRole({ role: 'TEST' })).toBe('TEST');
    expect(resolveUserRole({ role: 'ADMIN' })).toBe('ADMIN');
    expect(resolveUserRole({ role: 'SUPER_ADMIN' })).toBe('SUPER_ADMIN');
  });

  // 10. Usage tracking continues for TEST accounts
  it('10. records accurate usage statistics regardless of TEST quota allowance', () => {
    recordTokensUsed(testUid, 'server_managed', 'gemini-2.5-flash', 15_420);
    recordTokensUsed(testUid, 'server_managed', 'gemini-2.5-flash', 8_200);
    expect(getStoredTokensUsed(testUid)).toBe(23_620);
  });

  // 11. Helper functions
  it('11. correctly identifies test role helper', () => {
    expect(isTestRole('TEST')).toBe(true);
    expect(isTestRole('USER')).toBe(false);
    expect(isTestRole('ADMIN')).toBe(false);
    expect(isTestRole(null)).toBe(false);
  });
});
