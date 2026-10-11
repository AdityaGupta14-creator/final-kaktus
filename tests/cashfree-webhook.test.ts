import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as webhookRoute } from '../src/app/api/cashfree/webhook/route';
import { db } from '../src/lib/server/firebase-admin';
import { adminSupabase } from '../src/lib/server/supabase';
import crypto from 'crypto';

// Mock dependencies
vi.mock('../src/lib/server/firebase-admin', () => {
  return {
    db: {
      collection: vi.fn(() => ({ doc: vi.fn() })),
      runTransaction: vi.fn(),
      batch: vi.fn(),
    }
  };
});

vi.mock('../src/lib/server/supabase', () => {
  return {
    adminSupabase: {
      from: vi.fn(),
    }
  };
});

function createMockRequest(payload: any, secret: string) {
  const rawBody = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  
  return new Request('http://localhost/api/webhook', {
    method: 'POST',
    headers: {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body: rawBody
  });
}

describe('Cashfree Webhook Tests', () => {
  const SECRET = 'test_secret';
  
  beforeEach(() => {
    process.env.CASHFREE_SECRET_KEY = SECRET;
    vi.clearAllMocks();
  });

  it('rejects incorrect signature', async () => {
    const req = new Request('http://localhost/api/webhook', {
      method: 'POST',
      headers: {
        'x-webhook-signature': 'invalid_sig',
        'x-webhook-timestamp': '123',
      },
      body: JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' })
    });
    
    const res = await webhookRoute(req);
    expect(res.status).toBe(401);
  });

  it('rejects unknown order', async () => {
    db.runTransaction = vi.fn().mockRejectedValue(new Error('UNKNOWN_ORDER'));
    
    const req = createMockRequest({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: { payment: { payment_status: 'SUCCESS' }, order: { order_id: 'bad_id', order_amount: 100, order_currency: 'INR' } }
    }, SECRET);

    const res = await webhookRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('UNKNOWN_ORDER');
  });

  it('rejects amount mismatch', async () => {
    db.runTransaction = vi.fn().mockRejectedValue(new Error('AMOUNT_MISMATCH'));
    
    const req = createMockRequest({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: { payment: { payment_status: 'SUCCESS' }, order: { order_id: 'good_id', order_amount: 500, order_currency: 'INR' } }
    }, SECRET);

    const res = await webhookRoute(req);
    expect(res.status).toBe(400);
  });
});
