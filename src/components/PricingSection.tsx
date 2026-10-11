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
  
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [cashfreeInstance, setCashfreeInstance] = useState<any>(null);

  useEffect(() => {
    // Preload Cashfree SDK immediately on mount so checkout opens instantaneously
    import('@cashfreepayments/cashfree-js').then(({ load }) => {
      load({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox',
      }).then(cf => setCashfreeInstance(cf));
    }).catch(console.error);
  }, []);

  const handlePlanClick = async (planId: string, planName: string, price: string) => {
    if (!user) {
      router.push(planId === 'free' ? '/login?redirect=/ide' : '/login?redirect=' + encodeURIComponent('/#pricing'));
      return;
    }

    if (planId === 'free') {
      router.push('/ide');
      return;
    }

    setLoadingPlanId(planId);
    setError('');

    try {
      // 1. Create order session
      const response = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          amount: price,
          customerId: user.uid,
          customerEmail: user.email,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create payment session.');

      const paymentSessionId = data.payment_session_id;

      // 2. Ensure Cashfree instance is available
      let cf = cashfreeInstance;
      if (!cf) {
        const { load } = await import('@cashfreepayments/cashfree-js');
        cf = await load({
          mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox',
        });
        setCashfreeInstance(cf);
      }

      // 3. Immediately launch checkout in 1 click
      cf.checkout({
        paymentSessionId,
        redirectTarget: "_self",
      });
    } catch (err: any) {
      console.error("Checkout error:", err);
      setError(typeof err === 'string' ? err : (err.message || 'Payment initialization failed.'));
      setSelectedPlan({ id: planId, name: planName, price });
    } finally {
      setLoadingPlanId(null);
    }
  };

  return (
    <section id="pricing" className="w-full py-32 px-6 md:px-12 bg-[#09090b] text-white border-t border-zinc-900">
      <div className="max-w-7xl mx-auto flex flex-col items-center">
        <FadeIn className="text-center mb-20 max-w-3xl">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-white">Simple, transparent pricing.</h2>
          <p className="text-xl text-zinc-400 leading-relaxed">
            Start building for free. Upgrade for advanced reasoning and complex projects using our Pro models.
          </p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 w-full max-w-6xl">
          {/* Free Plan */}
          <FadeIn delay={0.1} className="flex flex-col p-8 bg-[#111114] rounded-3xl border border-zinc-850 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2 text-white">Free</h3>
            <p className="text-zinc-400 mb-6 text-sm">Perfect for learning and simple circuits.</p>
            <div className="text-5xl font-black mb-8 text-white">₹0<span className="text-lg text-zinc-500 font-normal">/mo</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-200 font-bold">25k Tokens Daily</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400 font-medium">Standard Processing Speed</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400">Gemini 2.5 Flash & 2.5 Flash Lite</span></li>
            </ul>
            <button 
              onClick={() => handlePlanClick('free', 'Free', '0')} 
              className="w-full py-4 text-center rounded-xl bg-zinc-800 text-zinc-300 font-bold hover:bg-zinc-700 transition-colors"
            >
              Current Plan
            </button>
          </FadeIn>

          {/* Starter Plan */}
          <FadeIn delay={0.2} className="flex flex-col p-8 bg-[#16161a] rounded-3xl border-2 border-zinc-500 shadow-2xl relative z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-800 border border-zinc-600 text-zinc-200 px-4 py-1 rounded-full text-xs font-mono font-bold tracking-wider">POPULAR</div>
            <h3 className="text-2xl font-bold mb-2 text-white">Starter</h3>
            <p className="text-zinc-400 mb-6 text-sm">Unlock better reasoning (1 week).</p>
            <div className="text-5xl font-black mb-8 text-white">₹39<span className="text-lg text-zinc-500 font-normal">/1 week</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-300 flex-shrink-0" /><span className="text-white font-bold">50k Daily Tokens Quota</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-300 flex-shrink-0" /><span className="text-zinc-300 font-medium">Fast Processing Speed</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-300 flex-shrink-0" /><span className="text-white font-bold">Unlocks Gemini 3.5 Flash</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-300 flex-shrink-0" /><span className="text-zinc-400">7 Days Full Access</span></li>
            </ul>
            <button 
              disabled={loadingPlanId !== null}
              onClick={() => handlePlanClick('starter', 'Starter', '39')} 
              className="w-full py-4 text-center rounded-xl bg-white hover:bg-zinc-200 text-black font-bold transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-75 cursor-pointer"
            >
              {loadingPlanId === 'starter' ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Opening Checkout...</>
              ) : (
                'Pay ₹39 Now'
              )}
            </button>
          </FadeIn>

          {/* Booster Plan */}
          <FadeIn delay={0.3} className="flex flex-col p-8 bg-[#111114] rounded-3xl border border-zinc-800/90 hover:border-zinc-700 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2 text-white">Booster</h3>
            <p className="text-zinc-400 mb-6 text-sm">For mid-term projects (2 weeks).</p>
            <div className="text-5xl font-black mb-8 text-white">₹69<span className="text-lg text-zinc-500 font-normal">/2 weeks</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-200 font-bold">75k Daily Tokens Quota</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400 font-medium">Priority Processing Speed</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-200 font-bold">Unlocks 3.5 & 3.6 Flash</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400">14 Days Full Access</span></li>
            </ul>
            <button 
              disabled={loadingPlanId !== null}
              onClick={() => handlePlanClick('booster', 'Booster', '69')} 
              className="w-full py-4 text-center rounded-xl bg-white hover:bg-zinc-200 text-black font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-75 cursor-pointer"
            >
              {loadingPlanId === 'booster' ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Opening Checkout...</>
              ) : (
                'Pay ₹69 Now'
              )}
            </button>
          </FadeIn>

          {/* Pro Plan */}
          <FadeIn delay={0.4} className="flex flex-col p-8 bg-[#111114] rounded-3xl border border-zinc-800/90 hover:border-zinc-700 shadow-sm relative">
            <h3 className="text-2xl font-bold mb-2 text-white">Pro</h3>
            <p className="text-zinc-400 mb-6 text-sm">For serious builders and engineers (1 month).</p>
            <div className="text-5xl font-black mb-8 text-white">₹169<span className="text-lg text-zinc-500 font-normal">/1 month</span></div>
            <ul className="flex flex-col gap-4 mb-8 flex-grow text-sm">
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-200 font-bold">100k Daily Tokens Quota</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400 font-medium">Max Processing Speed</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-200 font-bold">Unlocks 3.7 & 3.8 Flash</span></li>
              <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-zinc-400 flex-shrink-0" /><span className="text-zinc-400">30 Days Full Access</span></li>
            </ul>
            <button 
              disabled={loadingPlanId !== null}
              onClick={() => handlePlanClick('pro', 'Pro', '169')} 
              className="w-full py-4 text-center rounded-xl bg-white hover:bg-zinc-200 text-black font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-75 cursor-pointer"
            >
              {loadingPlanId === 'pro' ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Opening Checkout...</>
              ) : (
                'Pay ₹169 Now'
              )}
            </button>
          </FadeIn>
        </div>

        {/* Enterprise / Custom Plan */}
        <FadeIn delay={0.5} className="mt-8 w-full max-w-6xl">
          <div className="bg-[#111114] border border-zinc-800 rounded-3xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between text-white shadow-2xl">
            <div className="mb-6 md:mb-0 text-center md:text-left">
              <h3 className="text-3xl font-bold mb-2">Need Custom Tokens?</h3>
              <p className="text-zinc-400 max-w-xl">
                Require massive token limits, custom enterprise models, or team API access? Contact our admin to get a personalized pricing plan tailored for your heavy workloads.
              </p>
            </div>
            <a 
              href="mailto:admin@kaktus.com?subject=Custom Enterprise Pricing Inquiry" 
              className="bg-white text-black hover:bg-zinc-200 font-bold py-4 px-8 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-xl whitespace-nowrap cursor-pointer"
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
              className="relative w-full max-w-md bg-[#111114] border border-zinc-800 rounded-3xl p-6 md:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden text-white"
            >
              <button onClick={() => setSelectedPlan(null)} className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors cursor-pointer">
                <X size={20} />
              </button>
              
              <h2 className="text-2xl font-bold mb-2 text-center text-white">Complete Payment</h2>
              <p className="text-zinc-400 text-center mb-6 text-sm">Plan: {selectedPlan.name} (₹{selectedPlan.price})</p>

              <div className="flex flex-col items-center bg-[#16161a] p-6 rounded-2xl border border-zinc-800 mb-6">
                <p className="text-xs text-zinc-400 mb-2 font-medium uppercase tracking-wider">Total Amount</p>
                <div className="text-5xl font-black text-white">₹{selectedPlan.price}</div>
              </div>

              {!user ? (
                <div className="flex flex-col gap-2 mt-2">
                  <p className="text-sm text-zinc-400 text-center mb-2">You must be logged in to proceed with payment.</p>
                  <button 
                    onClick={() => router.push('/login?redirect=' + encodeURIComponent('/#pricing'))}
                    className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center cursor-pointer"
                  >
                    Log In to Continue
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-4 mt-2">
                  {error && <p className="text-zinc-300 text-xs text-center bg-zinc-900 p-3 rounded-lg border border-zinc-800">{error}</p>}
                  <button 
                    onClick={() => handlePlanClick(selectedPlan.id, selectedPlan.name, selectedPlan.price)}
                    disabled={loadingPlanId !== null}
                    className="w-full bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-black font-bold py-3.5 rounded-xl transition-all shadow-lg flex items-center justify-center text-sm gap-2 cursor-pointer"
                  >
                    {loadingPlanId !== null ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Opening Gateway...</>
                    ) : (
                      `Pay ₹${selectedPlan.price} with Cashfree`
                    )}
                  </button>
                  <p className="text-xs text-zinc-500 text-center mt-1">Payment will securely open in Cashfree checkout.</p>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
