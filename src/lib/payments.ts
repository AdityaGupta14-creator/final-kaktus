import { doc, setDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface PaymentSettings {
  upiId: string;
  upiQrUrl: string;
}

export interface PaymentTransaction {
  id: string;
  uid: string;
  email: string | null;
  planId: string;
  txnId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

/**
 * Fetches current public payment settings (UPI ID & QR Code) via API
 */
export const getAdminPaymentSettings = async (): Promise<PaymentSettings> => {
  try {
    const res = await fetch('/api/admin/settings');
    if (res.ok) {
      const data = await res.json();
      return {
        upiId: data.upiId || '',
        upiQrUrl: data.upiQrUrl || '',
      };
    }
  } catch (error) {
    console.error('[Payments] Error fetching payment settings via API:', error);
  }
  return { upiId: '', upiQrUrl: '' };
};

/**
 * Updates payment settings via secure server admin route
 */
export const updateAdminPaymentSettings = async (settings: PaymentSettings, idToken?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

  const res = await fetch('/api/admin/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify(settings),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update payment settings.');
  }
};

/**
 * Submits user transaction verification to the payments collection
 */
export const submitPaymentVerification = async (uid: string, email: string | null, planId: string, txnId: string) => {
  const docRef = doc(collection(db, 'payments'));
  await setDoc(docRef, {
    id: docRef.id,
    uid,
    email,
    planId,
    txnId,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

/**
 * Fetches pending payment verifications via secure server route
 */
export const getPendingPayments = async (idToken?: string): Promise<PaymentTransaction[]> => {
  try {
    const headers: Record<string, string> = {};
    if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

    const res = await fetch('/api/admin/payments', { headers });
    if (res.ok) {
      const data = await res.json();
      return data.payments || [];
    }
    console.warn('[Payments] Non-OK response fetching pending payments:', res.statusText);
  } catch (error) {
    console.error('[Payments] Error fetching pending payments:', error);
  }
  return [];
};

/**
 * Approves a transaction and updates user plan entitlements via secure server endpoint
 */
export const approvePayment = async (txn: PaymentTransaction, idToken?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

  const res = await fetch('/api/admin/payments', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'approve', paymentId: txn.id }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to approve payment.');
  }
};

/**
 * Rejects a transaction via secure server endpoint
 */
export const rejectPayment = async (txnId: string, idToken?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

  const res = await fetch('/api/admin/payments', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'reject', paymentId: txnId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to reject payment.');
  }
};
