import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderError, maskKey } from '../src/lib/server/api-key-manager.ts';
import { checkRateLimit } from '../src/lib/server/rate-limiter.ts';
import { isValidRole, canAssignRoles, VALID_ROLES } from '../src/lib/server/roles.ts';
import { resolveUserRole } from '../src/lib/server/firebase-admin.ts';
import { setSecurityLogSinkForTesting } from '../src/lib/server/security-logger.ts';

// Isolate security logging in tests to prevent unmocked Firestore network calls
const capturedSecurityLogs = [];
setSecurityLogSinkForTesting((event) => {
  capturedSecurityLogs.push(event);
});

test('maskKey: correctly masks raw API keys without leaking characters', () => {
  assert.equal(maskKey('AIzaSyD4g7FakeKey1234A92F'), '••••••••A92F');
  assert.equal(maskKey('short'), '••••••••');
  assert.equal(maskKey(''), '••••••••');
});

test('classifyProviderError: correctly categorizes quota and rate limits', () => {
  assert.equal(classifyProviderError(429, 'Resource has been exhausted (e.g. check quota)'), 'RATE_LIMIT');
  assert.equal(classifyProviderError(200, 'Quota exceeded for quota metric'), 'RATE_LIMIT');
});

test('classifyProviderError: categorizes authentication and revoked keys as AUTH_FAILURE', () => {
  assert.equal(classifyProviderError(401, 'API key not valid. Please pass a valid API key.'), 'AUTH_FAILURE');
  assert.equal(classifyProviderError(403, 'The caller does not have permission / api key expired'), 'AUTH_FAILURE');
});

test('classifyProviderError: categorizes client syntax errors as CLIENT_ERROR without rotating keys', () => {
  assert.equal(classifyProviderError(400, 'Invalid argument: contents is required'), 'CLIENT_ERROR');
  assert.equal(classifyProviderError(413, 'Request payload too large'), 'CLIENT_ERROR');
});

test('classifyProviderError: categorizes upstream 5xx and gateway errors as SERVER_ERROR', () => {
  assert.equal(classifyProviderError(500, 'Internal server error'), 'SERVER_ERROR');
  assert.equal(classifyProviderError(502, 'Bad gateway'), 'SERVER_ERROR');
  assert.equal(classifyProviderError(503, 'Service unavailable'), 'SERVER_ERROR');
});

test('rateLimiter: permits requests under the limit and tracks remaining quota', () => {
  const userId = `test_user_${Date.now()}`;
  const res1 = checkRateLimit(userId, 'test-endpoint');
  assert.equal(res1.allowed, true);
  assert.ok(res1.remaining > 0);

  const res2 = checkRateLimit(userId, 'test-endpoint');
  assert.equal(res2.allowed, true);
  assert.equal(res2.remaining, res1.remaining - 1);
});

test('rateLimiter: isolates different users independently', () => {
  const userA = `user_a_${Date.now()}`;
  const userB = `user_b_${Date.now()}`;

  const resA = checkRateLimit(userA, 'test-endpoint');
  const resB = checkRateLimit(userB, 'test-endpoint');

  assert.equal(resA.remaining, resB.remaining);
});

test('rateLimiter: blocks requests once threshold is reached with reset indication', () => {
  const burstUser = `burst_user_${Date.now()}`;
  let lastRes;
  for (let i = 0; i < 35; i++) {
    lastRes = checkRateLimit(burstUser, 'burst-endpoint');
  }

  assert.equal(lastRes.allowed, false);
  assert.equal(lastRes.remaining, 0);
  assert.ok(lastRes.resetSeconds > 0);
  assert.ok(capturedSecurityLogs.some(l => l.type === 'USER_RATE_LIMITED' && l.actor.uid === burstUser));
});

test('roles: isValidRole accepts only authoritative roles', () => {
  for (const role of VALID_ROLES) {
    assert.equal(isValidRole(role), true);
  }
  assert.equal(isValidRole('INVENTORY_MANAGER'), false);
  assert.equal(isValidRole('ROOT'), false);
  assert.equal(isValidRole(''), false);
  assert.equal(isValidRole(null), false);
});

test('roles: only SUPER_ADMIN can assign roles', () => {
  assert.equal(canAssignRoles('SUPER_ADMIN'), true);
  assert.equal(canAssignRoles('ADMIN'), false);
  assert.equal(canAssignRoles('SUPPORT'), false);
  assert.equal(canAssignRoles('FINANCE'), false);
  assert.equal(canAssignRoles('USER'), false);
  assert.equal(canAssignRoles(undefined), false);
});

test('bootstrap: SUPER_ADMIN_EMAIL resolves to SUPER_ADMIN', () => {
  process.env.SUPER_ADMIN_EMAIL = 'mahesh.gupta8952@gmail.com';
  const decodedToken = {
    uid: 'test_super_uid_123',
    email: 'mahesh.gupta8952@gmail.com',
  };
  const role = resolveUserRole(decodedToken);
  assert.equal(role, 'SUPER_ADMIN');
});

test('bootstrap: normal email resolves to USER without bootstrap or claim', () => {
  const decodedToken = {
    uid: 'normal_user_456',
    email: 'normal.user@example.com',
  };
  const role = resolveUserRole(decodedToken);
  assert.equal(role, 'USER');
});

test('bootstrap: custom claims are respected when present', () => {
  const decodedAdmin = {
    uid: 'admin_user_789',
    email: 'some.admin@example.com',
    role: 'ADMIN',
  };
  assert.equal(resolveUserRole(decodedAdmin), 'ADMIN');

  const decodedFinance = {
    uid: 'finance_user_101',
    email: 'finance@example.com',
    role: 'FINANCE',
  };
  assert.equal(resolveUserRole(decodedFinance), 'FINANCE');
});
