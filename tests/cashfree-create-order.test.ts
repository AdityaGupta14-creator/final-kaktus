import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as createOrderRoute } from '../src/app/api/cashfree/create-order/route';
import { requireAuthenticatedUser } from '../src/lib/server/auth';

vi.mock('../src/lib/server/auth', () => ({
  requireAuthenticatedUser: vi.fn(),
  handleAuthError: vi.fn(),
}));

vi.mock('../src/lib/server/plans', () => ({
  getPlanConfig: vi.fn(() => ({ price: 100 })),
}));

describe('Cashfree Create Order API Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects order creation because payments are disabled', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({ uid: 'user123', email: 'test@example.com' } as any);
    
    const req = new Request('http://localhost/api/cashfree/create-order', {
      method: 'POST',
      body: JSON.stringify({ planId: 'pro' }),
    });

    const res = await createOrderRoute(req);
    expect(res.status).toBe(403);
    
    const data = await res.json();
    expect(data.error).toMatch(/Payments are currently disabled/i);
  });
});
