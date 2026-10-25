export const runtime = 'nodejs';

import crypto from 'crypto';
import { requireAuthenticatedUser, handleAuthError } from '@/lib/server/auth';
import { db } from '@/lib/server/firebase-admin';
import { PLANS } from '@/lib/server/plans';
import { checkSharedRateLimit, rateLimitExceededResponse } from '@/lib/server/rate-limiter';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://yc-drab.vercel.app';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const limit = await checkSharedRateLimit(user.uid, 'cashfree-create-order', 5, 3600);
    if (!limit.allowed) return rateLimitExceededResponse(limit);
    const body = await request.json().catch(() => null);
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    const plan = PLANS[planId];
    if (!plan || plan.id === 'free' || plan.price <= 0) {
      return Response.json({ error: 'Choose a valid paid plan.' }, { status: 400 });
    }

    const customerEmail = user.email || (typeof body?.customerEmail === 'string' ? body.customerEmail.trim() : '');
    if (!customerEmail || customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return Response.json({ error: 'A valid account email is required for checkout.' }, { status: 400 });
    }
    const customerPhone = typeof body?.customerPhone === 'string' && /^\+?[0-9]{8,15}$/.test(body.customerPhone.trim())
      ? body.customerPhone.trim()
      : '9999999999';

    const appId = process.env.CASHFREE_APP_ID;
    const appSecret = process.env.CASHFREE_SECRET_KEY;
    if (!appId || !appSecret) {
      return Response.json({ error: 'Payment checkout is not configured.' }, { status: 503 });
    }

    const orderId = `kkt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const paymentRef = db.collection('payments').doc(orderId);
    await paymentRef.set({
      uid: user.uid,
      email: customerEmail,
      planId: plan.id,
      amount: plan.price,
      currency: 'INR',
      status: 'pending',
      createdAt: new Date().toISOString(),
      provider: 'cashfree',
    });

    const isProd = process.env.CASHFREE_ENV === 'PRODUCTION';
    const endpoint = isProd ? 'https://api.cashfree.com/pg/orders' : 'https://sandbox.cashfree.com/pg/orders';
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-client-id': appId,
          'x-client-secret': appSecret,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: orderId,
          order_amount: plan.price,
          order_currency: 'INR',
          customer_details: {
            customer_id: user.uid,
            customer_email: customerEmail,
            customer_phone: customerPhone,
          },
          order_meta: {
            return_url: `${APP_URL}/verify-payment?order_id={order_id}&plan_id=${encodeURIComponent(plan.id)}`,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      await paymentRef.set({ status: 'checkout_failed' }, { merge: true });
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.payment_session_id !== 'string') {
      await paymentRef.set({ status: 'checkout_failed' }, { merge: true });
      console.error('[Cashfree] Create order rejected:', response.status);
      return Response.json({ error: 'Payment provider could not create the checkout session.' }, { status: 502 });
    }

    return Response.json({ payment_session_id: data.payment_session_id, order_id: orderId }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) return handleAuthError(error);
    console.error('[Cashfree] Create order failed:', error instanceof Error ? error.name : 'Unknown error');
    return Response.json({ error: 'Could not initialize checkout. Try again shortly.' }, { status: 500 });
  }
}
