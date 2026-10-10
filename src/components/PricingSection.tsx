'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

// Reusing FadeIn for smooth reveals
function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode, delay?: number, className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.8, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function PricingSection() {
  const { user } = useAuth();
  const router = useRouter();
  
  const [selectedPlan, setSelectedPlan] = useState<{ id: string, name: string, price: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Prefetched Cashfree data
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cashfreeInstance, setCashfreeInstance] = useState<any>(null);
  const orderPromiseRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    // Preload Cashfree SDK on mount so it's ready instantly when needed
    import('@cashfreepayments/cashfree-js').then(({ load }) => {
      load({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox',
      }).then(cf => setCashfreeInstance(cf));
    }).catch(console.error);
  }, []);

  const handlePlanClick = async (planId: string, planName: string, price: string) => {
    if (!user) {
      router.push(planId === 'free' ? '/login?redirect=/ide' : '/login?redirect=/#pricing');
      return;
    }

    if (planId === 'free') {
      router.push('/ide');
      return;
    }

    setSelectedPlan({ id: planId, name: planName, price });
    setError('');
    setSessionId(null);
    orderPromiseRef.current = null;
    
    // Prefetch order session and store the promise so we don't duplicate it
    const promise = fetch('/api/cashfree/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planId,
        amount: price,
        customerId: user.uid,
        customerEmail: user.email,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.payment_session_id) {
          setSessionId(data.payment_session_id);
          return data.payment_session_id;
        }
        throw new Error(data.error || 'Failed to create payment session.');
      });
      
    orderPromiseRef.current = promise;
    
    try {
      await promise;
    } catch (e) {
      console.error("Prefetch order failed", e);
    }
  };

  const handleCashfreePayment = async () => {
    if (!user) {
      setError('Please login first to proceed with payment.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let currentSessionId = sessionId;

      // Wait for the in-flight order creation if it hasn't finished yet
      if (!currentSessionId && orderPromiseRef.current) {
        currentSessionId = await orderPromiseRef.current;
      }

      // Fallback if something failed
      if (!currentSessionId) {
        const response = await fetch('/api/cashfree/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: selectedPlan!.id,
            amount: selectedPlan!.price,
            customerId: user.uid,
            customerEmail: user.email,
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create payment session.');
        currentSessionId = data.payment_session_id;
      }

      let cf = cashfreeInstance;
      if (!cf) {
        const { load } = await import('@cashfreepayments/cashfree-js');
        cf = await load({
          mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox',
        });
        setCashfreeInstance(cf);
      }

      cf.checkout({
        paymentSessionId: currentSessionId,
        redirectTarget: "_self",
      });
    } catch (err: any) {
      console.error("Checkout error:", err);
      setError(typeof err === 'string' ? err : (err.message || 'Payment initialization failed.'));
      setSessionId(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="pricing" className="w-full py-32 px-6 md:px-12 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto flex flex-col items-center">
        <FadeIn className="text-center mb-20 max-w-3xl">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Simple, transparent pricing.</h2>
          <p className="text-xl text-gray-500 leading-relaxed">
            Start building for free. Upgrade for advanced reasoning and complex projects using our Pro models.
          </p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 w-full max-w-6xl">
          {/* Free Plan */}
          <FadeIn delay={0.1} className="flex flex-col p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-gray-500 mb-6">Perfect for learning and simple circuits.</p>
            <div className="text-5xl font-black mb-8">₹0<span className="text-lg text-gray-400 font-normal">/mo</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-bold text-black">25k Tokens Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-medium">5 Flash Runs Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600">Gemini 2.5 Flash / Lite</span></li>
            </ul>
            <button 
              onClick={() => handlePlanClick('free', 'Free', '0')} 
              className="w-full py-4 text-center rounded-xl bg-gray-200 text-gray-800 font-bold hover:bg-gray-300 transition-colors"
            >
              Current Plan
            </button>
          </FadeIn>

          {/* 1 Week Plan */}
          <FadeIn delay={0.2} className="flex flex-col p-8 bg-white rounded-3xl border-2 border-green-500 shadow-xl relative z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-green-500 text-white px-4 py-1 rounded-full text-xs font-bold tracking-wide">POPULAR</div>
            <h3 className="text-2xl font-bold mb-2">Starter</h3>
            <p className="text-gray-500 mb-6">Unlock better reasoning for 1 week.</p>
            <div className="text-5xl font-black mb-8">₹29<span className="text-lg text-gray-400 font-normal">/week</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-bold text-black">40k Tokens Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-medium">10 Flash Runs Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-blue-600 font-bold">Unlocks 3.5 Flash-Lite</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600">15x Reasoning Capacity</span></li>
            </ul>
            <button 
              onClick={() => handlePlanClick('starter', 'Starter', '29')} 
              className="w-full py-4 text-center rounded-xl bg-green-500 text-white font-bold hover:bg-green-600 transition-colors shadow-md"
            >
              Start Trial
            </button>
          </FadeIn>

          {/* 2 Week Plan */}
          <FadeIn delay={0.3} className="flex flex-col p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2">Booster</h3>
            <p className="text-gray-500 mb-6">For your mid-term projects (2 weeks).</p>
            <div className="text-5xl font-black mb-8">₹59<span className="text-lg text-gray-400 font-normal">/14 days</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-bold text-black">60k Tokens Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-medium">20 Flash Runs Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-blue-600 font-bold">Unlocks 3.5 & 3.6 Flash</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600">30x Reasoning Capacity</span></li>
            </ul>
            <button 
              onClick={() => handlePlanClick('booster', 'Booster', '59')} 
              className="w-full py-4 text-center rounded-xl bg-gray-900 text-white font-bold hover:bg-black transition-colors"
            >
              Upgrade
            </button>
          </FadeIn>

          {/* 1 Month Plan */}
          <FadeIn delay={0.4} className="flex flex-col p-8 bg-gray-50 rounded-3xl border border-gray-100 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2">Pro</h3>
            <p className="text-gray-500 mb-6">For serious builders and engineers.</p>
            <div className="text-5xl font-black mb-8">₹159<span className="text-lg text-gray-400 font-normal">/month</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-bold text-black">100k Tokens Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600 font-medium">50 Flash Runs Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-blue-600 font-bold">Unlocks 3.7 & 3.8 Flash</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" /><span className="text-gray-600">100x Reasoning Capacity</span></li>
            </ul>
            <button 
              onClick={() => handlePlanClick('pro', 'Pro', '159')} 
              className="w-full py-4 text-center rounded-xl bg-gray-900 text-white font-bold hover:bg-black transition-colors"
            >
              Upgrade
            </button>
          </FadeIn>
        </div>

        {/* Enterprise / Custom Plan */}
        <FadeIn delay={0.5} className="mt-8 w-full max-w-6xl">
          <div className="bg-gradient-to-r from-gray-900 to-black rounded-3xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between text-white shadow-2xl">
            <div className="mb-6 md:mb-0 text-center md:text-left">
              <h3 className="text-3xl font-bold mb-2">Need Custom Tokens?</h3>
              <p className="text-gray-400 max-w-xl">
                Require massive token limits, custom enterprise models, or team API access? Contact our admin to get a personalized pricing plan tailored for your heavy workloads.
              </p>
            </div>
            <a 
              href="mailto:admin@kaktus.com?subject=Custom Enterprise Pricing Inquiry" 
              className="bg-white text-black hover:bg-gray-200 font-bold py-4 px-8 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-xl whitespace-nowrap"
            >
              Contact Admin
            </a>
          </div>
        </FadeIn>
      </div>

      {/* Payment Modal */}
      <AnimatePresence>
        {selectedPlan && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedPlan(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col overflow-hidden"
            >
              <button onClick={() => setSelectedPlan(null)} className="absolute top-4 right-4 text-gray-400 hover:text-black">
                <X size={24} />
              </button>
              
              <h2 className="text-2xl font-bold mb-2 text-center text-black">Complete Payment</h2>
              <p className="text-gray-500 text-center mb-6">Plan: {selectedPlan.name} (₹{selectedPlan.price})</p>

              <div className="flex flex-col items-center bg-gray-50 p-6 rounded-2xl border border-gray-100 mb-6">
                <p className="text-sm text-gray-500 mb-2 font-medium uppercase tracking-wider">Total Amount</p>
                <div className="text-5xl font-black text-black">₹{selectedPlan.price}</div>
              </div>

              {!user ? (
                <div className="flex flex-col gap-2 mt-2">
                  <p className="text-sm text-gray-600 text-center mb-2">You must be logged in to proceed with payment.</p>
                  <button 
                    onClick={() => router.push('/login?redirect=/#pricing')}
                    className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-xl transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md flex items-center justify-center"
                  >
                    Log In to Continue
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4 mt-2">
                  {error && <p className="text-red-600 text-sm text-center bg-red-50 p-3 rounded-lg border border-red-200">{error}</p>}
                  <button 
                    onClick={handleCashfreePayment}
                    disabled={submitting || (!sessionId && !error && !submitting)}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-all duration-300 ease-in-out shadow-lg flex items-center justify-center text-lg gap-2"
                  >
                    {submitting ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Opening Gateway...</>
                    ) : (!sessionId && !error) ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Preparing Session...</>
                    ) : (
                      'Pay Now with Cashfree'
                    )}
                  </button>
                  <p className="text-xs text-gray-400 text-center mt-1">Payment will securely open in a popup.</p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
