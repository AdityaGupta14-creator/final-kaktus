import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/lib/server/firebase-admin';

export async function POST(req: Request) {
  try {
    const configuredSecret = process.env.SMS_WEBHOOK_SECRET;
    if (!configuredSecret) {
      return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 8_192) {
      return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    }
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 8_192) {
      return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    }
    const body = JSON.parse(rawBody);
    const { utr, amount, secret } = body;

    const provided = typeof secret === 'string' ? Buffer.from(secret) : Buffer.alloc(0);
    const expected = Buffer.from(configuredSecret);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (typeof utr !== 'string' || !/^[A-Za-z0-9-]{6,80}$/.test(utr.trim())) {
      return NextResponse.json({ error: 'UTR is required' }, { status: 400 });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > 10_000_000) {
      return NextResponse.json({ error: 'Amount is invalid.' }, { status: 400 });
    }

    // Save the received UTR to Firestore
    const utrRef = db.collection('received_utrs').doc(utr.trim());
    try {
      await utrRef.create({
        utr: utr.trim(),
        amount: numericAmount,
        used: false,
        receivedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      if (error?.code === 6 || error?.code === 'already-exists') {
        return NextResponse.json({ success: true, note: 'Duplicate UTR ignored.' });
      }
      throw error;
    }

    return NextResponse.json({ success: true, message: 'UTR saved successfully' });
  } catch (error: any) {
    console.error('Webhook error:', error?.name || 'Unknown error');
    return NextResponse.json({ error: 'Webhook request failed.' }, { status: 500 });
  }
}
