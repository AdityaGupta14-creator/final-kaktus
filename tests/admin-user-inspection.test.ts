import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as inspectUserRoute } from '../src/app/api/admin/users/[uid]/route';
import { requireRole, AuthError } from '../src/lib/server/auth';
import { auth, db } from '../src/lib/server/firebase-admin';
import { adminSupabase } from '../src/lib/server/supabase';
import { getTokenLimit } from '../src/lib/tokens';
import { calculateUsageCost } from '../src/lib/server/model-pricing';

// Mocks
vi.mock('../src/lib/server/auth', async () => {
  const actual = await vi.importActual<any>('../src/lib/server/auth');
  return {
    ...actual,
    requireRole: vi.fn(),
  };
});

vi.mock('../src/lib/server/firebase-admin', () => {
  const mockAuth = {
    getUser: vi.fn(),
  };

  const mockDoc = vi.fn();
  const mockDb = {
    collection: vi.fn(() => ({
      doc: mockDoc,
    })),
  };

  return {
    auth: mockAuth,
    db: mockDb,
  };
});

vi.mock('../src/lib/server/supabase', () => {
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null });

  const queryChain: any = {
    select: vi.fn(() => queryChain),
    eq: vi.fn(() => queryChain),
    order: vi.fn(() => queryChain),
    limit: vi.fn(() => queryChain),
    gte: vi.fn(() => queryChain),
    maybeSingle: mockMaybeSingle,
  };

  return {
    adminSupabase: {
      from: vi.fn(() => queryChain),
      rpc: vi.fn().mockResolvedValue({ data: { allowed: true }, error: null }),
    },
  };
});

describe('Admin User Inspection & Usage Metrics Verification Suite', () => {
  const targetUidA = 'target-user-uid-A';
  const targetUidB = 'target-user-uid-B';

  const mockAuthUser = {
    uid: targetUidA,
    email: 'usera@example.com',
    displayName: 'User Alpha',
    metadata: {
      creationTime: '2026-09-01T00:00:00Z',
      lastSignInTime: '2026-10-18T10:00:00Z',
    },
    customClaims: { role: 'USER' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (auth.getUser as any).mockResolvedValue(mockAuthUser);
    (db.collection as any).mockReturnValue({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          })),
        })),
      })),
    });
  });

  // 1. ADMIN can view usage for a selected user
  it('1. allows an authenticated ADMIN to view any user profile and API usage', async () => {
    (requireRole as any).mockResolvedValue({
      uid: 'admin-caller',
      email: 'admin@example.com',
      role: 'ADMIN',
    });

    const mockUsageRows = [
      {
        id: 'req-1',
        user_uid: targetUidA,
        model: 'models/gemini-2.5-flash',
        success: true,
        duration_ms: 1200,
        input_tokens: 500,
        output_tokens: 150,
        total_tokens: 650,
        created_at: new Date().toISOString(),
      },
    ];

    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn(() => queryChain),
      order: vi.fn(() => queryChain),
      limit: vi.fn().mockResolvedValue({ data: mockUsageRows, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.profile.uid).toBe(targetUidA);
    expect(json.usage.totalRequests).toBe(1);
    expect(json.usage.successfulRequests).toBe(1);
    expect(json.usage.totalTokens).toBe(650);
    expect(requireRole).toHaveBeenCalledWith(expect.any(Request), ['SUPER_ADMIN', 'ADMIN']);
  });

  // 2. SUPER_ADMIN can view usage for a selected user
  it('2. allows an authenticated SUPER_ADMIN to view any user profile and API usage', async () => {
    (requireRole as any).mockResolvedValue({
      uid: 'super-admin-caller',
      email: 'super@example.com',
      role: 'SUPER_ADMIN',
    });

    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn(() => queryChain),
      order: vi.fn(() => queryChain),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.profile.uid).toBe(targetUidA);
  });

  // 3. A normal USER cannot access another user's usage
  it('3. rejects a standard USER attempting to inspect another user profile with 403 Forbidden', async () => {
    (requireRole as any).mockImplementation(() => {
      throw new AuthError("Forbidden. Role 'USER' lacks permission for this action.", 403, 'INSUFFICIENT_ROLE');
    });

    const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Forbidden');
  });

  // 4. SUPPORT and FINANCE follow existing authorization policy
  it('4. strictly blocks SUPPORT and FINANCE roles from inspecting arbitrary user API usage', async () => {
    for (const forbiddenRole of ['SUPPORT', 'FINANCE', 'TEST'] as const) {
      (requireRole as any).mockImplementation(() => {
        throw new AuthError(`Forbidden. Role '${forbiddenRole}' lacks permission.`, 403, 'INSUFFICIENT_ROLE');
      });

      const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
      const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
      expect(res.status).toBe(403);
    }
  });

  // 5. Usage from User A never appears in User B's profile
  it('5. ensures strict data isolation so User A usage never leaks to User B', async () => {
    (requireRole as any).mockResolvedValue({ uid: 'admin', role: 'ADMIN' });

    let queriedUid = '';
    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn((col, val) => {
        if (col === 'user_uid') queriedUid = val;
        return queryChain;
      }),
      order: vi.fn(() => queryChain),
      limit: vi.fn().mockImplementation(() => {
        // Return records matching ONLY queriedUid
        if (queriedUid === targetUidB) {
          return Promise.resolve({
            data: [
              {
                id: 'req-user-b',
                user_uid: targetUidB,
                model: 'gemini-2.5-flash-lite',
                success: true,
                total_tokens: 1500,
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    (auth.getUser as any).mockResolvedValue({
      uid: targetUidB,
      email: 'userb@example.com',
      metadata: {},
    });

    const req = new Request(`http://localhost/api/admin/users/${targetUidB}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidB }) });
    const json = await res.json();

    expect(json.profile.uid).toBe(targetUidB);
    expect(queriedUid).toBe(targetUidB);
    expect(json.usage.totalTokens).toBe(1500);
    // User B history contains only User B's request
    expect(json.usage.history[0].id).toBe('req-user-b');
  });

  // 6. An account with no usage records renders a valid empty state
  it('6. renders a valid empty usage state for accounts with 0 recorded requests', async () => {
    (requireRole as any).mockResolvedValue({ uid: 'admin', role: 'ADMIN' });

    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn(() => queryChain),
      order: vi.fn(() => queryChain),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.usage.totalRequests).toBe(0);
    expect(json.usage.successfulRequests).toBe(0);
    expect(json.usage.failedRequests).toBe(0);
    expect(json.usage.totalTokens).toBe(0);
    expect(json.usage.estimatedCostUsd).toBe(0);
    expect(json.usage.history).toEqual([]);
    expect(json.usage.dailyBreakdown).toEqual([]);
    expect(json.usage.modelBreakdown).toEqual({});
    expect(json.usage.quota.dailyLimit).toBe(75_000); // Standard free tier limit
    expect(json.usage.quota.dailyUsed).toBe(0);
    expect(json.usage.quota.dailyRemaining).toBe(75_000);
  });

  // 7. Pagination and date filters return correct aggregates
  it('7. correctly applies date window filters and history pagination', async () => {
    (requireRole as any).mockResolvedValue({ uid: 'admin', role: 'ADMIN' });

    const now = Date.now();
    const rows = [
      {
        id: 'row-today',
        user_uid: targetUidA,
        model: 'gemini-2.5-flash',
        success: true,
        total_tokens: 1000,
        created_at: new Date(now).toISOString(),
      },
      {
        id: 'row-yesterday',
        user_uid: targetUidA,
        model: 'gemini-2.5-flash',
        success: true,
        total_tokens: 2000,
        created_at: new Date(now - 86400000).toISOString(),
      },
      {
        id: 'row-old',
        user_uid: targetUidA,
        model: 'gemini-2.5-flash',
        success: true,
        total_tokens: 5000,
        created_at: new Date(now - 15 * 86400000).toISOString(), // 15 days ago
      },
    ];

    let gteApplied = false;
    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn(() => queryChain),
      order: vi.fn(() => queryChain),
      gte: vi.fn(() => {
        gteApplied = true;
        return queryChain;
      }),
      limit: vi.fn().mockImplementation(() => {
        // If gte is applied (7 days), only return first 2 rows
        const filtered = gteApplied ? rows.slice(0, 2) : rows;
        return Promise.resolve({ data: filtered, error: null });
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    // Request with 7-day filter, limit=1, offset=1
    const req = new Request(`http://localhost/api/admin/users/${targetUidA}?days=7&limit=1&offset=1`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(gteApplied).toBe(true);
    expect(json.usage.filterDays).toBe('7');
    expect(json.usage.totalTokens).toBe(3000); // 1000 + 2000
    expect(json.usage.pagination.limit).toBe(1);
    expect(json.usage.pagination.offset).toBe(1);
    expect(json.usage.history.length).toBe(1);
    expect(json.usage.history[0].id).toBe('row-yesterday');
  });

  // 8. Failed requests and missing token fields do not break the profile
  it('8. gracefully handles failed requests, missing token fields, and sanitizes error types', async () => {
    (requireRole as any).mockResolvedValue({ uid: 'admin', role: 'ADMIN' });

    const mixedRows = [
      {
        id: 'err-row-1',
        user_uid: targetUidA,
        model: 'gemini-2.0-flash',
        success: false,
        failure: true,
        error_type: 'QUOTA_EXCEEDED',
        duration_ms: 450,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 'err-row-2',
        user_uid: targetUidA,
        model: 'gemini-2.0-flash',
        success: false,
        failure: true,
        error_type: 'AIzaSyKeyLeakedInsideError',
        duration_ms: 120,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        created_at: new Date().toISOString(),
      },
    ];

    const queryChain: any = {
      select: vi.fn(() => queryChain),
      eq: vi.fn(() => queryChain),
      order: vi.fn(() => queryChain),
      limit: vi.fn().mockResolvedValue({ data: mixedRows, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    (adminSupabase.from as any).mockReturnValue(queryChain);

    const req = new Request(`http://localhost/api/admin/users/${targetUidA}`);
    const res = await inspectUserRoute(req, { params: Promise.resolve({ uid: targetUidA }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.usage.totalRequests).toBe(2);
    expect(json.usage.failedRequests).toBe(2);
    expect(json.usage.successfulRequests).toBe(0);
    expect(json.usage.totalTokens).toBe(0);
    expect(json.usage.history[0].status).toBe('FAILED');
    expect(json.usage.history[0].errorType).toBe('QUOTA_EXCEEDED');
    // Leaked key pattern must be sanitized!
    expect(json.usage.history[1].errorType).toBe('AUTHENTICATION_ERROR');
    expect(json.usage.history[1].errorType).not.toContain('AIzaSy');
  });

  // 9. Existing API quota enforcement and model pricing continue to work
  it('9. preserves accurate model pricing calculations and existing quota enforcement semantics', () => {
    // Pricing checks
    const flashLiteCost = calculateUsageCost('gemini-2.5-flash-lite', 1_000_000, 1_000_000);
    expect(flashLiteCost).toBeCloseTo(0.075 + 0.30, 4);

    const flashCost = calculateUsageCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    expect(flashCost).toBeCloseTo(0.10 + 0.40, 4);

    const proCost = calculateUsageCost('gemini-1.5-pro', 1_000_000, 1_000_000);
    expect(proCost).toBeCloseTo(1.25 + 5.00, 4);

    // Blended rate when only total tokens is known
    const blendedCost = calculateUsageCost('gemini-2.5-flash-lite', null, null, 1_000_000);
    // 0.075 * 0.75 + 0.30 * 0.25 = 0.05625 + 0.075 = 0.13125
    expect(blendedCost).toBeCloseTo(0.13125, 4);

    // Quota limits checks
    expect(getTokenLimit('free')).toBe(75_000);
    expect(getTokenLimit('starter')).toBe(165_000);
    expect(getTokenLimit('booster')).toBe(255_000);
    expect(getTokenLimit('pro')).toBe(335_000);
    expect(getTokenLimit('free', null, 'ADMIN')).toBe(1_000_000);
    expect(getTokenLimit('free', null, 'SUPER_ADMIN')).toBe(1_000_000);
    expect(getTokenLimit('free', null, 'TEST', 'HIGH')).toBe(500_000);
  });
});
