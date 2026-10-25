export const runtime = 'nodejs';

import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { checkSharedRateLimit, rateLimitExceededResponse } from '@/lib/server/rate-limiter';

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,45}$/;

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const limit = await checkSharedRateLimit(user.uid, 'cashfree-verify-order', 20, 60);
    if (!limit.allowed) return rateLimitExceededResponse(limit);
    const body = await request.json().catch(() => null);
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return Response.json({ error: 'A valid order ID is required.' }, { status: 400 });
    }

    const paymentSnap = await db.collection('payments').doc(orderId).get();
    if (!paymentSnap.exists) return Response.json({ error: 'Payment order not found.' }, { status: 404 });
    const payment = paymentSnap.data();
    if (payment?.uid !== user.uid) return Response.json({ error: 'Payment order not found.' }, { status: 404 });

    if (payment.status === 'approved') {
      return Response.json({ status: 'PAID', plan: payment.planId }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const appId = process.env.CASHFREE_APP_ID;
    const appSecret = process.env.CASHFREE_SECRET_KEY;
    if (!appId || !appSecret) {
      return Response.json({ error: 'Payment verification is not configured.' }, { status: 503 });
    }
    const isProd = process.env.CASHFREE_ENV === 'PRODUCTION';
    const baseUrl = isProd ? 'https://api.cashfree.com/pg/orders' : 'https://sandbox.cashfree.com/pg/orders';
    const response = await fetch(`${baseUrl}/${encodeURIComponent(orderId)}`, {
      headers: {
        'x-client-id': appId,
        'x-client-secret': appSecret,
        'x-api-version': '2023-08-01',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[Cashfree] Verify order rejected:', response.status);
      return Response.json({ error: 'Payment provider could not verify this order.' }, { status: 502 });
    }

    const ownerMatches = data.customer_details?.customer_id === user.uid;
    const orderMatches = data.order_id === orderId
      && Number(data.order_amount) === Number(payment.amount)
      && data.order_currency === payment.currency;
    if (!ownerMatches || !orderMatches) {
      console.warn('[Cashfree] Order verification mismatch:', orderId);
      return Response.json({ error: 'Payment verification details did not match this account.' }, { status: 409 });
    }

    return Response.json({ status: data.order_status, plan: payment.planId }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) return handleAuthError(error);
    console.error('[Cashfree] Verify order failed:', error instanceof Error ? error.name : 'Unknown error');
    return Response.json({ error: 'Could not verify payment. Try again shortly.' }, { status: 500 });
  }
}
