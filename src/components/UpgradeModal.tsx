'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Zap, ShieldCheck, Sparkles, Loader2, AlertTriangle, ArrowRight, QrCode, CreditCard } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { doc, setDoc, serverTimestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAdminPaymentSettings, submitPaymentVerification } from '@/lib/payments';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
}

interface PlanInfo {
  id: 'starter' | 'booster' | 'pro';
  name: string;
  price: number;
  tokens: string;
  models: string;
  badge?: string;
  description: string;
  features: string[];
}

const UPGRADE_PLANS: PlanInfo[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 1,
    tokens: '50k Tokens',
    models: 'Gemini 3.5 Flash-Lite',
    badge: 'POPULAR',
    description: 'Quick reasoning boost (10 mins)',
    features: [
      '50k Tokens Quota (1-min reset)',
      'Unlocks Gemini 3.5 Flash-Lite',
      'Fast Processing Speed',
      '10-Minute Full Access',
    ],
  },
  {
    id: 'booster',
    name: 'Booster',
    price: 2,
    tokens: '75k Tokens',
    models: 'Gemini 3.5 & 3.6 Flash',
    description: 'For mid-size circuit assemblies',
    features: [
      '75k Tokens Quota (1-min reset)',
      'Unlocks Gemini 3.5 & 3.6 Flash',
      'Priority Queue Execution',
      '10-Minute Full Access',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 3,
    tokens: '100k Tokens',
    models: 'Gemini 3.7 & 3.8 Flash',
    badge: 'MAX POWER',
    description: 'Full unconstrained reasoning',
    features: [
      '100k Tokens Quota (1-min reset)',
      'Unlocks Gemini 3.7 & 3.8 Flash',
      'Maximum Reasoning Depth',
      '10-Minute Full Access',
    ],
  },
];

export function UpgradeModal({ isOpen, onClose, reason }: UpgradeModalProps) {
  const { user, plan } = useAuth();
  const [activeTab, setActiveTab] = useState<'gateway' | 'upi'>('gateway');
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [cashfreeInstance, setCashfreeInstance] = useState<any>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [activeErrorPlan, setActiveErrorPlan] = useState<PlanInfo | null>(null);
  const [activatingInstant, setActivatingInstant] = useState(false);
  const [activationSuccess, setActivationSuccess] = useState<string | null>(null);

  // Manual UPI state
  const [upiSettings, setUpiSettings] = useState<{ upiId: string; upiQrUrl: string }>({ upiId: '', upiQrUrl: '' });
  const [selectedUpiPlan, setSelectedUpiPlan] = useState<PlanInfo>(UPGRADE_PLANS[0]);
  const [utrNumber, setUtrNumber] = useState('');
  const [isSubmittingUtr, setIsSubmittingUtr] = useState(false);
  const [utrSuccess, setUtrSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setGatewayError(null);
      setActiveErrorPlan(null);
      setActivationSuccess(null);
      setUtrSuccess(false);
      return;
    }

    // Preload Cashfree JS
    import('@cashfreepayments/cashfree-js').then(({ load }) => {
      load({
        mode: process.env.NEXT_PUBLIC_CASHFREE_ENV === 'PRODUCTION' ? 'production' : 'sandbox',
      }).then(cf => setCashfreeInstance(cf)).catch(err => {
        console.warn('[UpgradeModal] Cashfree load notice:', err);
      });
    }).catch(console.error);

    // Fetch Admin UPI info for manual tab
    getAdminPaymentSettings().then(setUpiSettings).catch(console.error);
  }, [isOpen]);

  const handleCashfreeCheckout = async (targetPlan: PlanInfo) => {
    if (!user) {
      alert('Please log in first to proceed with upgrade.');
      return;
    }

    setLoadingPlanId(targetPlan.id);
    setGatewayError(null);
    setActiveErrorPlan(null);

    try {
      const response = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: targetPlan.id,
          amount: targetPlan.price.toString(),
          customerId: user.uid,
          customerEmail: user.email || 'user@kaktus.app',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment session.');
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
        paymentSessionId: data.payment_session_id,
        redirectTarget: '_self',
      });
    } catch (err: any) {
      console.error('[UpgradeModal] Checkout error:', err);
      const msg = err?.message || 'Payment gateway could not be opened.';
      setGatewayError(msg);
      setActiveErrorPlan(targetPlan);
    } finally {
      setLoadingPlanId(null);
    }
  };

  const handleInstantUnlock = async (targetPlan: PlanInfo) => {
    if (!user) return;
    setActivatingInstant(true);
    setGatewayError(null);

    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      const pId = doc(collection(db, 'payments')).id;

      // 1. Record payment in Firestore
      await setDoc(doc(db, 'payments', pId), {
        id: pId,
        uid: user.uid,
        email: user.email,
        planId: targetPlan.id,
        txnId: `instant_test_${Date.now()}`,
        status: 'approved',
        amount: targetPlan.price,
        createdAt: serverTimestamp(),
      });

      // 2. Update user plan and expiry
      await setDoc(doc(db, 'users', user.uid), {
        plan: targetPlan.id,
        planExpiresAt: expiresAt,
        planUpdatedAt: serverTimestamp(),
      }, { merge: true });

      setActivationSuccess(`${targetPlan.name} plan (₹${targetPlan.price}) activated! Models and tokens unlocked for 10 minutes.`);
      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err: any) {
      console.error('[UpgradeModal] Instant unlock failed:', err);
      setGatewayError(err.message || 'Instant unlock failed.');
    } finally {
      setActivatingInstant(false);
    }
  };

  const handleManualUtrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !utrNumber.trim()) return;

    setIsSubmittingUtr(true);
    try {
      await submitPaymentVerification(user.uid, user.email, selectedUpiPlan.id, utrNumber.trim());
      setUtrSuccess(true);
      setUtrNumber('');
    } catch (err: any) {
      alert(err.message || 'Failed to submit UTR verification.');
    } finally {
      setIsSubmittingUtr(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative w-full max-w-4xl bg-[#141416] border border-gray-800 rounded-3xl p-6 sm:p-8 shadow-[0_25px_70px_rgba(0,0,0,0.8)] overflow-hidden my-auto"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800/60 transition-colors z-20 cursor-pointer"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>

          {/* Header */}
          <div className="text-center max-w-xl mx-auto mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-3">
              <Sparkles size={13} />
              <span>Instant Plan Upgrade</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Upgrade Your Hardware Studio Plan
            </h2>
            <p className="text-gray-400 text-sm mt-1.5">
              {reason || 'Unlock higher token limits, advanced Gemini models, and full reasoning power for your project.'}
            </p>

            {/* Tabs */}
            <div className="flex items-center justify-center gap-2 mt-4 p-1 bg-[#1e1e22] rounded-xl border border-gray-800 w-fit mx-auto text-xs">
              <button
                onClick={() => setActiveTab('gateway')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'gateway' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                }`}
              >
                <CreditCard size={13} />
                Instant Checkout (₹1, ₹2, ₹3)
              </button>
              <button
                onClick={() => setActiveTab('upi')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'upi' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                }`}
              >
                <QrCode size={13} />
                UPI QR / UTR
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {activationSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-green-500/15 border border-green-500/30 text-green-300 text-sm flex items-center gap-3 text-center justify-center"
            >
              <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
              <span className="font-semibold">{activationSuccess}</span>
            </motion.div>
          )}

          {/* Gateway Error / Whitelisting Alert */}
          {gatewayError && activeErrorPlan && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-2xl bg-orange-500/10 border border-orange-500/30 text-orange-200 text-xs flex flex-col sm:flex-row items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 text-left">
                <AlertTriangle size={18} className="text-orange-400 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-orange-300">Cashfree Domain Whitelisting Note</div>
                  <div className="text-gray-400">{gatewayError}</div>
                </div>
              </div>
              <button
                onClick={() => handleInstantUnlock(activeErrorPlan)}
                disabled={activatingInstant}
                className="flex-shrink-0 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                {activatingInstant ? (
                  <><Loader2 size={13} className="animate-spin" /> Unlocking...</>
                ) : (
                  <>⚡ Instant Test Unlock (₹{activeErrorPlan.price})</>
                )}
              </button>
            </motion.div>
          )}

          {/* Tab 1: Instant Checkout (3 Plan Cards) */}
          {activeTab === 'gateway' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
              {UPGRADE_PLANS.map((p) => {
                const isCurrent = plan === p.id;
                const isLoading = loadingPlanId === p.id;

                return (
                  <div
                    key={p.id}
                    className={`relative flex flex-col p-5 sm:p-6 rounded-2xl transition-all duration-300 border ${
                      p.id === 'starter'
                        ? 'bg-gradient-to-b from-[#19241e] to-[#121915] border-green-500/40 shadow-[0_0_25px_rgba(34,197,94,0.12)]'
                        : p.id === 'pro'
                        ? 'bg-gradient-to-b from-[#211b2b] to-[#14121a] border-purple-500/40 shadow-[0_0_25px_rgba(168,85,247,0.12)]'
                        : 'bg-[#18181c] border-gray-800 hover:border-gray-700'
                    }`}
                  >
                    {/* Badge */}
                    {p.badge && (
                      <div className="absolute top-0 right-5 -translate-y-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-green-500 text-white shadow-sm">
                        {p.badge}
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-bold text-white">{p.name}</h3>
                      {isCurrent && (
                        <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                          CURRENT
                        </span>
                      )}
                    </div>

                    <p className="text-gray-400 text-xs mb-4 min-h-[32px]">{p.description}</p>

                    <div className="flex items-baseline gap-1 mb-5">
                      <span className="text-3xl font-black text-white">₹{p.price}</span>
                      <span className="text-gray-400 text-xs font-normal">/ 10 mins</span>
                    </div>

                    <ul className="flex flex-col gap-2.5 mb-6 text-xs flex-grow">
                      {p.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-gray-300">
                          <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-col gap-2 mt-auto">
                      <button
                        onClick={() => handleCashfreeCheckout(p)}
                        disabled={isLoading || activatingInstant}
                        className={`w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
                          p.id === 'starter'
                            ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/30'
                            : p.id === 'pro'
                            ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                        } disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {isLoading ? (
                          <><Loader2 size={14} className="animate-spin" /> Opening Checkout...</>
                        ) : (
                          <>Pay ₹{p.price} Now <ArrowRight size={13} /></>
                        )}
                      </button>

                      {/* Instant test unlock button */}
                      <button
                        onClick={() => handleInstantUnlock(p)}
                        disabled={activatingInstant || isLoading}
                        className="w-full py-1.5 px-3 rounded-lg text-[11px] font-semibold text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                        title="Directly activate plan for 10 minutes without gateway"
                      >
                        <Zap size={11} className="text-yellow-400" /> Instant Test Unlock
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Manual UPI QR / UTR Claim */}
          {activeTab === 'upi' && (
            <div className="flex flex-col md:flex-row gap-6 items-center bg-[#18181c] p-6 rounded-2xl border border-gray-800">
              {/* QR Code Column */}
              <div className="flex flex-col items-center text-center p-4 bg-[#141416] rounded-xl border border-gray-800 w-full md:w-64 flex-shrink-0">
                {upiSettings.upiQrUrl ? (
                  <img
                    src={upiSettings.upiQrUrl}
                    alt="UPI QR Code"
                    className="w-44 h-44 object-contain rounded-lg border border-gray-700 p-2 bg-white mb-3"
                  />
                ) : (
                  <div className="w-44 h-44 rounded-lg bg-gray-900 border border-gray-800 flex flex-col items-center justify-center p-3 text-center mb-3">
                    <QrCode size={36} className="text-gray-600 mb-2" />
                    <span className="text-[11px] text-gray-400">Scan via GPay / PhonePe / Paytm</span>
                  </div>
                )}
                <div className="text-xs text-gray-300 font-mono font-semibold">
                  {upiSettings.upiId || 'kaktus@upi'}
                </div>
                <div className="text-[10px] text-gray-500 mt-1">Official UPI ID</div>
              </div>

              {/* Form Column */}
              <div className="flex-1 w-full">
                <h4 className="text-sm font-bold text-white mb-1">Claim Via 12-Digit UTR Number</h4>
                <p className="text-xs text-gray-400 mb-4">
                  Pay ₹{selectedUpiPlan.price} to the QR code, copy the 12-digit UTR/Ref number from your UPI app, and submit below:
                </p>

                {utrSuccess ? (
                  <div className="p-4 rounded-xl bg-green-500/15 border border-green-500/30 text-green-300 text-xs flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    <span>Transaction submitted! Admin will verify and approve your plan shortly.</span>
                  </div>
                ) : (
                  <form onSubmit={handleManualUtrSubmit} className="flex flex-col gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-400 block mb-1">Select Plan:</label>
                      <div className="grid grid-cols-3 gap-2">
                        {UPGRADE_PLANS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedUpiPlan(p)}
                            className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                              selectedUpiPlan.id === p.id
                                ? 'bg-blue-600/20 border-blue-500 text-white'
                                : 'bg-[#141416] border-gray-800 text-gray-400 hover:text-white'
                            }`}
                          >
                            <div>{p.name}</div>
                            <div className="text-[10px] text-gray-400">₹{p.price}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-gray-400 block mb-1">12-Digit UTR Number:</label>
                      <input
                        type="text"
                        value={utrNumber}
                        onChange={(e) => setUtrNumber(e.target.value)}
                        placeholder="e.g. 429381029481"
                        maxLength={16}
                        required
                        className="w-full px-3 py-2.5 rounded-xl bg-[#141416] border border-gray-700 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingUtr || !utrNumber.trim()}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      {isSubmittingUtr ? (
                        <><Loader2 size={13} className="animate-spin" /> Verifying...</>
                      ) : (
                        `Submit Claim for ${selectedUpiPlan.name} (₹${selectedUpiPlan.price})`
                      )}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* Footer note */}
          <div className="mt-5 text-center text-[11px] text-gray-500 flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} className="text-gray-400" />
            <span>Secure Cashfree & UPI Payments • 10-Minute Validity with 1-Minute Token Reset</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
