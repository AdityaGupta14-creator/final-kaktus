'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { doc, setDoc, updateDoc, serverTimestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { PaymentTransaction, approvePayment } from '@/lib/payments';

export default function VerifyPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  
  const [status, setStatus] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) {
      router.push('/login?redirect=/#pricing');
      return;
    }

    const verifyOrder = async () => {
      const orderId = searchParams.get('order_id');
      const planId = searchParams.get('plan_id');

      if (!orderId || !planId) {
        setStatus('failed');
        setErrorMsg('Invalid payment return data.');
        return;
      }

      try {
        const response = await fetch('/api/cashfree/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });

        const data = await response.json();

        if (data.status === 'PAID') {
          // Success! Approve the payment manually here or just save it
          const pId = doc(collection(db, 'payments')).id;
          const txn: PaymentTransaction = {
            id: pId,
            uid: user.uid,
            email: user.email,
            planId: planId,
            txnId: orderId, // Using Cashfree order ID as our txn ID
            status: 'approved',
            createdAt: serverTimestamp()
          };
          
          await setDoc(doc(db, 'payments', pId), txn);
          await approvePayment(txn);
          
          setStatus('success');
          setTimeout(() => {
            router.push('/ide');
          }, 1500);
        } else {
          setStatus('failed');
          setErrorMsg(`Payment not successful. Status: ${data.status}`);
        }
      } catch (err: any) {
        setStatus('failed');
        setErrorMsg(err.message || 'Verification failed');
      }
    };

    verifyOrder();
  }, [user, authLoading, router, searchParams]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-white max-w-md w-full rounded-2xl p-8 shadow-2xl flex flex-col items-center text-center">
        {status === 'verifying' && (
          <>
            <Loader2 className="w-16 h-16 text-blue-600 animate-spin mb-6" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Verifying Payment...</h2>
            <p className="text-gray-500">Please wait while we confirm your transaction securely.</p>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h2>
            <p className="text-gray-500 mb-6">Your plan has been activated. Redirecting you to the IDE...</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <XCircle className="w-12 h-12 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h2>
            <p className="text-gray-500 mb-6">{errorMsg}</p>
            <button 
              onClick={() => router.push('/#pricing')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-all"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
