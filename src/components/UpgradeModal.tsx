'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, ShieldCheck, ArrowRight, QrCode, Sparkles, Zap, Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { getAdminPaymentSettings, submitPaymentVerification } from '@/lib/payments';

export interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
}

export interface PlanInfo {
  id: 'starter' | 'booster' | 'pro';
  name: string;
  price: number;
  badge?: string;
  description: string;
  features: string[];
}

export const UPGRADE_PLANS: PlanInfo[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 1,
    badge: 'POPULAR',
    description: 'Quick reasoning boost (10 mins)',
    features: [
      '165k Daily Tokens Quota',
      'Unlocks Gemini 3.5 Flash',
      'Fast Processing Speed',
      '10-Minute Full Access',
    ],
  },
  {
    id: 'booster',
    name: 'Booster',
    price: 2,
    badge: 'RECOMMENDED',
    description: 'For mid-size circuit assemblies',
    features: [
      '255k Daily Tokens Quota',
      'Unlocks Gemini 3.5 & 3.6 Flash',
      'Priority Queue Execution',
      '10-Minute Full Access',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 3,
    badge: 'MAX POWER',
    description: 'Full unconstrained reasoning',
    features: [
      '335k Daily Tokens Quota',
      'Unlocks Gemini 3.7 & 3.8 Flash',
      'Maximum Reasoning Depth',
      '10-Minute Full Access',
    ],
  },
];

export function UpgradeModal({ isOpen, onClose, reason }: UpgradeModalProps) {
  const { user, plan: currentPlan } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'plans' | 'upi'>('plans');
  const [selectedUpiPlan, setSelectedUpiPlan] = useState<PlanInfo>(UPGRADE_PLANS[0]);
  const [utrNumber, setUtrNumber] = useState('');
  const [isSubmittingUtr, setIsSubmittingUtr] = useState(false);
  const [utrSuccess, setUtrSuccess] = useState(false);
  const [upiSettings, setUpiSettings] = useState<{ upiId: string; upiQrUrl: string }>({ upiId: '', upiQrUrl: '' });
  const [isActivatingInstant, setIsActivatingInstant] = useState(false);

  // User click on card or button -> redirect directly to the main landing page pricing section
  const handleSelectPlan = (plan: PlanInfo) => {
    onClose();
    if (typeof window !== 'undefined') {
      window.location.href = '/#pricing';
    } else {
      router.push('/#pricing');
    }
  };

  const handleInstantUnlock = async (e: React.MouseEvent, plan: PlanInfo) => {
    e.stopPropagation();
    setIsActivatingInstant(true);
    try {
      const res = await fetch('/api/user/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.id }),
      });
      if (res.ok) {
        onClose();
        window.location.reload();
      } else {
        window.location.href = '/#pricing';
      }
    } catch {
      window.location.href = '/#pricing';
    } finally {
      setIsActivatingInstant(false);
    }
  };

  const handleOpenUpiTab = async () => {
    setActiveTab('upi');
    try {
      const s = await getAdminPaymentSettings();
      setUpiSettings(s);
    } catch (err) {
      console.warn('[UpgradeModal] Could not fetch UPI settings:', err);
    }
  };

  const handleManualUtrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!utrNumber.trim() || !user) return;
    setIsSubmittingUtr(true);
    try {
      await submitPaymentVerification(
        user.uid,
        user.email || 'user',
        selectedUpiPlan.id,
        utrNumber.trim()
      );
      setUtrSuccess(true);
      setTimeout(() => {
        setUtrSuccess(false);
        setUtrNumber('');
        onClose();
      }, 2500);
    } catch (err: any) {
      alert(err.message || 'Submission failed. Please check your UTR number.');
    } finally {
      setIsSubmittingUtr(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 14 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="relative w-full max-w-4xl bg-[#09090b] border border-zinc-800 rounded-3xl p-6 md:p-8 shadow-[0_25px_70px_rgba(0,0,0,0.95)] text-white overflow-hidden"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800/60 transition-colors z-20 cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          {/* Header */}
          <div className="text-center mb-7">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-300 mb-3 tracking-wide">
              <Sparkles size={12} className="text-zinc-400" />
              <span>Instant Plan Upgrade</span>
            </div>
            <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white mb-2">
              Upgrade Your Hardware Studio Plan
            </h3>
            <p className="text-xs md:text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
              {reason || 'Unlock higher token limits, advanced Gemini models, and full reasoning power for your project.'}
            </p>

            {/* Clean Industry-level monochrome tabs */}
            <div className="flex items-center justify-center gap-1 mt-5 bg-[#121215] p-1 rounded-xl border border-zinc-800 w-fit mx-auto">
              <button
                type="button"
                onClick={() => setActiveTab('plans')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'plans'
                    ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Instant Checkout (₹1, ₹2, ₹3)
              </button>
              <button
                type="button"
                onClick={handleOpenUpiTab}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'upi'
                    ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                UPI QR / UTR
              </button>
            </div>
          </div>

          {/* Tab 1: Industry-level Black / Grey / White Plan Cards */}
          {activeTab === 'plans' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
              {UPGRADE_PLANS.map((p) => {
                const isCurrent = currentPlan?.toLowerCase() === p.id;
                const isBooster = p.id === 'booster';

                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectPlan(p)}
                    className={`relative flex flex-col p-6 rounded-2xl transition-all cursor-pointer group ${
                      isBooster
                        ? 'bg-[#151518] border-2 border-zinc-500 shadow-xl hover:border-zinc-300 hover:bg-[#18181c]'
                        : 'bg-[#111114] border border-zinc-800 hover:border-zinc-500 hover:bg-[#151518]'
                    }`}
                  >
                    {/* Badge */}
                    <div className="flex items-center justify-between mb-3 min-h-[22px]">
                      <h4 className="text-base font-bold text-white tracking-tight">{p.name}</h4>
                      {p.badge && (
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200">
                          {p.badge}
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                          CURRENT
                        </span>
                      )}
                    </div>

                    <p className="text-zinc-400 text-xs mb-4 min-h-[34px] leading-relaxed">
                      {p.description}
                    </p>

                    <div className="flex items-baseline gap-1.5 mb-5 pb-4 border-b border-zinc-800">
                      <span className="text-3xl font-black text-white tracking-tight">₹{p.price}</span>
                      <span className="text-zinc-400 text-xs font-normal">/ 10 mins</span>
                    </div>

                    <ul className="flex flex-col gap-2.5 mb-6 text-xs flex-grow">
                      {p.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2.5 text-zinc-300">
                          <CheckCircle2 size={13} className="text-zinc-400 flex-shrink-0 group-hover:text-white transition-colors" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Action button */}
                    <div className="flex flex-col gap-2 mt-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectPlan(p);
                        }}
                        className="w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm bg-white hover:bg-zinc-200 text-black hover:scale-[1.01] active:scale-[0.99]"
                      >
                        <span>Pay ₹{p.price} Now</span>
                        <ArrowRight size={13} />
                      </button>

                      {/* Instant test unlock button */}
                      <button
                        type="button"
                        onClick={(e) => handleInstantUnlock(e, p)}
                        disabled={isActivatingInstant}
                        className="w-full py-1.5 px-3 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                        title="Directly activate plan for 10 minutes"
                      >
                        <Zap size={11} className="text-zinc-400" />
                        <span>Instant Test Unlock</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Manual UPI QR / UTR Claim (Clean Monochrome) */}
          {activeTab === 'upi' && (
            <div className="flex flex-col md:flex-row gap-6 items-center bg-[#111114] p-6 rounded-2xl border border-zinc-800">
              {/* QR Code Column */}
              <div className="flex flex-col items-center text-center p-4 bg-[#161619] rounded-xl border border-zinc-800 w-full md:w-64 flex-shrink-0">
                {upiSettings.upiQrUrl ? (
                  <img
                    src={upiSettings.upiQrUrl}
                    alt="UPI QR Code"
                    className="w-44 h-44 object-contain rounded-lg border border-zinc-700 p-2 bg-white mb-3"
                  />
                ) : (
                  <div className="w-44 h-44 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-center p-3 text-center mb-3">
                    <QrCode size={36} className="text-zinc-500 mb-2" />
                    <span className="text-[11px] text-zinc-400">Scan via GPay / PhonePe / Paytm</span>
                  </div>
                )}
                <div className="text-xs text-zinc-200 font-mono font-semibold">
                  {upiSettings.upiId || 'kaktus@upi'}
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">Official UPI ID</div>
              </div>

              {/* Form Column */}
              <div className="flex-1 w-full">
                <h4 className="text-sm font-bold text-white mb-1">Claim Via 12-Digit UTR Number</h4>
                <p className="text-xs text-zinc-400 mb-4">
                  Pay ₹{selectedUpiPlan.price} to the QR code, copy the 12-digit UTR/Ref number from your UPI app, and submit below:
                </p>

                {utrSuccess ? (
                  <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-white" />
                    <span>Transaction submitted! Admin will verify and activate your plan.</span>
                  </div>
                ) : (
                  <form onSubmit={handleManualUtrSubmit} className="flex flex-col gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-zinc-400 block mb-1">Select Plan:</label>
                      <div className="grid grid-cols-3 gap-2">
                        {UPGRADE_PLANS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedUpiPlan(p)}
                            className={`p-2 rounded-lg text-xs font-semibold border transition-all text-center cursor-pointer ${
                              selectedUpiPlan.id === p.id
                                ? 'bg-zinc-800 border-zinc-600 text-white'
                                : 'bg-[#161619] border-zinc-800 text-zinc-400 hover:text-white'
                            }`}
                          >
                            <div>{p.name}</div>
                            <div className="text-[10px] text-zinc-500">₹{p.price}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-zinc-400 block mb-1">12-Digit UTR Number:</label>
                      <input
                        type="text"
                        value={utrNumber}
                        onChange={(e) => setUtrNumber(e.target.value)}
                        placeholder="e.g. 429381029481"
                        maxLength={16}
                        required
                        className="w-full px-3 py-2.5 rounded-xl bg-[#161619] border border-zinc-800 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingUtr || !utrNumber.trim()}
                      className="w-full py-3 rounded-xl bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
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
          <div className="mt-6 text-center text-[11px] text-zinc-500 flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} className="text-zinc-400" />
            <span>Secure Cashfree & UPI Payments • 10-Minute Validity with 1-Minute Token Reset</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
