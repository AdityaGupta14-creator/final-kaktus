'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import { 
  Lock, ArrowLeft, Rocket, Beaker, CheckCircle2, 
  MessageSquare, History, Sparkles, Send, Loader2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Feature {
  slug: string;
  title: string;
  description: string;
  category: string;
  release_version: string;
  status: string;
  release_notes: string;
  testing_instructions: string;
  known_issues: string;
  published_at: string;
  accessible: boolean;
}

interface Feedback {
  id: string;
  feature_slug: string;
  type: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
}

export default function EarlyAccessPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [myFeedback, setMyFeedback] = useState<Feedback[]>([]);
  
  // Feedback form state
  const [feedbackFeature, setFeedbackFeature] = useState('');
  const [feedbackType, setFeedbackType] = useState('Suggestion');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDesc, setFeedbackDesc] = useState('');
  const [feedbackSteps, setFeedbackSteps] = useState('');
  const [feedbackSeverity, setFeedbackSeverity] = useState('Low');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login?redirect=/early-access');
      return;
    }

    const fetchData = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/early-access/features', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        
        setIsMember(data.isMember);
        setFeatures(data.features || []);
        setMyFeedback(data.myFeedback || []);
      } catch (error) {
        console.error('Failed to load early access data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, authLoading, router]);

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackTitle || !feedbackDesc || !feedbackType) return;
    
    setSubmittingFeedback(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/early-access/feedback', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          featureSlug: feedbackFeature,
          type: feedbackType,
          title: feedbackTitle,
          description: feedbackDesc,
          reproductionSteps: feedbackSteps,
          severity: feedbackType === 'Bug' ? feedbackSeverity : null
        })
      });

      if (res.ok) {
        const { feedback } = await res.json();
        setMyFeedback(prev => [feedback, ...prev]);
        setFeedbackSuccess(true);
        setTimeout(() => {
          setFeedbackSuccess(false);
          setFeedbackTitle('');
          setFeedbackDesc('');
          setFeedbackSteps('');
        }, 3000);
      }
    } catch (error) {
      console.error('Feedback submission failed:', error);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-gray-200 flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#111] p-8 rounded-2xl border border-gray-800 text-center shadow-2xl">
          <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-800">
            <Lock className="w-8 h-8 text-gray-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Invitation Required</h1>
          <p className="text-gray-400 mb-8 leading-relaxed">
            The Kaktus Early Access program is currently invite-only. 
            Super Admins can grant access to selected members.
          </p>
          <Link
            href="/ide"
            className="w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 rounded-xl transition-colors"
          >
            <ArrowLeft size={16} /> Return to IDE
          </Link>
        </div>
      </div>
    );
  }

  const latestFeature = features.length > 0 ? features[0] : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 font-sans selection:bg-green-500/30">
      {/* Navbar */}
      <nav className="border-b border-gray-800/60 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-[0_0_15px_rgba(74,222,128,0.3)]">
              <Beaker className="w-4 h-4 text-[#0a0a0a]" />
            </div>
            <span className="font-bold text-white tracking-wide">Kaktus Early Access</span>
          </div>
          <Link href="/ide" className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2">
            <ArrowLeft size={14} /> Back to IDE
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-16">
        
        {/* Hero Section */}
        <section className="relative rounded-3xl overflow-hidden border border-gray-800/50 bg-[#111] p-12">
          {/* Subtle PCB pattern overlay */}
          <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/circuit-board.png')]" />
          
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium mb-6 uppercase tracking-wider">
              <Sparkles size={12} /> Beta Program Active
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              Build with what's next.
            </h1>
            <p className="text-lg text-gray-400 mb-8 leading-relaxed">
              Test upcoming hardware tools before everyone else. Your feedback directly shapes the future of Kaktus. Currently exploring {features.length} beta features.
            </p>
            <a href="#releases" className="inline-flex items-center gap-2 bg-white text-black hover:bg-gray-200 font-semibold px-6 py-3 rounded-xl transition-colors">
              View What's New <ArrowLeft size={16} className="rotate-180" />
            </a>
          </div>
        </section>

        {/* Featured Beta Release */}
        {latestFeature && (
          <section id="releases">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Rocket size={16} /> Latest Release
            </h2>
            <div className="bg-gradient-to-br from-gray-900 to-[#111] border border-gray-800 rounded-2xl p-8 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-green-500/10 transition-colors" />
              
              <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="px-2.5 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono">v{latestFeature.release_version}</span>
                    <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${latestFeature.status === 'available' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {latestFeature.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{latestFeature.title}</h3>
                  <p className="text-gray-400 mb-6 leading-relaxed max-w-2xl">{latestFeature.description}</p>
                  
                  {latestFeature.accessible ? (
                    <div className="flex flex-wrap gap-4">
                      <Link href="/ide" className="bg-green-600 hover:bg-green-500 text-white font-medium px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2">
                        Try in IDE <ArrowLeft size={16} className="rotate-180" />
                      </Link>
                      <button onClick={() => setFeedbackFeature(latestFeature.slug)} className="bg-gray-800 hover:bg-gray-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors border border-gray-700">
                        Leave Feedback
                      </button>
                    </div>
                  ) : (
                    <div className="inline-block bg-gray-800/50 text-gray-400 border border-gray-700 px-4 py-2 rounded-lg text-sm">
                      <Lock size={14} className="inline mr-2" />
                      Not eligible for this feature
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          
          {/* Left Column: Explorer & Changelog */}
          <div className="lg:col-span-2 space-y-12">
            
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-6">Beta Feature Explorer</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {features.slice(1).map(feature => (
                  <div key={feature.slug} className="bg-[#111] border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-xs text-gray-500 font-mono">{feature.category}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${feature.accessible ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                        {feature.accessible ? 'Accessible' : 'Locked'}
                      </span>
                    </div>
                    <h4 className="text-white font-bold mb-2">{feature.title}</h4>
                    <p className="text-sm text-gray-400 line-clamp-2">{feature.description}</p>
                  </div>
                ))}
                {features.length <= 1 && (
                  <div className="col-span-2 p-8 border border-dashed border-gray-800 rounded-xl text-center text-gray-500">
                    No additional features in testing right now.
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-6">Release Notes</h2>
              <div className="space-y-6">
                {features.filter(f => f.release_notes).map(feature => (
                  <div key={feature.slug} className="relative pl-6 border-l border-gray-800">
                    <div className="absolute w-3 h-3 bg-gray-800 rounded-full -left-[1.5px] top-1.5 border-2 border-[#0a0a0a]" />
                    <div className="mb-1 text-sm text-gray-500">
                      {feature.published_at ? new Date(feature.published_at).toLocaleDateString() : 'Draft'} • v{feature.release_version}
                    </div>
                    <h4 className="text-white font-bold mb-2">{feature.title}</h4>
                    <div className="text-sm text-gray-400 prose prose-invert max-w-none">
                      {feature.release_notes}
                    </div>
                    {feature.testing_instructions && (
                      <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-800 text-sm">
                        <strong className="text-gray-300 block mb-1">Testing Objective:</strong>
                        <span className="text-gray-400">{feature.testing_instructions}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Feedback Form & History */}
          <div className="space-y-8">
            
            <section className="bg-[#111] border border-gray-800 rounded-2xl p-6 sticky top-24">
              <h2 className="text-sm font-bold text-white mb-6 flex items-center gap-2">
                <MessageSquare size={16} className="text-green-500" />
                Submit Feedback
              </h2>
              
              <form onSubmit={submitFeedback} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Feature</label>
                  <select 
                    value={feedbackFeature} onChange={e => setFeedbackFeature(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
                  >
                    <option value="">General Beta Feedback</option>
                    {features.filter(f => f.accessible).map(f => (
                      <option key={f.slug} value={f.slug}>{f.title}</option>
                    ))}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Type</label>
                    <select 
                      value={feedbackType} onChange={e => setFeedbackType(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
                    >
                      <option>Bug</option>
                      <option>UX Issue</option>
                      <option>Suggestion</option>
                    </select>
                  </div>
                  {feedbackType === 'Bug' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Severity</label>
                      <select 
                        value={feedbackSeverity} onChange={e => setFeedbackSeverity(e.target.value)}
                        className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
                      >
                        <option>Low</option>
                        <option>Medium</option>
                        <option>High</option>
                        <option>Blocker</option>
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Title</label>
                  <input 
                    type="text" required
                    value={feedbackTitle} onChange={e => setFeedbackTitle(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500"
                    placeholder="Brief summary..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
                  <textarea 
                    required rows={4}
                    value={feedbackDesc} onChange={e => setFeedbackDesc(e.target.value)}
                    className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500 resize-none"
                    placeholder="What happened or what's your idea?"
                  />
                </div>

                {feedbackType === 'Bug' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Reproduction Steps (Optional)</label>
                    <textarea 
                      rows={2}
                      value={feedbackSteps} onChange={e => setFeedbackSteps(e.target.value)}
                      className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500 resize-none"
                      placeholder="1. Go to... 2. Click..."
                    />
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={submittingFeedback || !feedbackTitle || !feedbackDesc}
                  className="w-full bg-white hover:bg-gray-200 disabled:bg-gray-800 disabled:text-gray-500 text-black font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm mt-2"
                >
                  {submittingFeedback ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}
                  {feedbackSuccess ? 'Submitted!' : 'Send to Engineering'}
                </button>
                
                <AnimatePresence>
                  {feedbackSuccess && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="text-xs text-green-400 flex items-center justify-center gap-1.5 mt-2"
                    >
                      <CheckCircle2 size={14} /> Thank you for shaping Kaktus!
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <History size={16} /> My Activity
              </h2>
              <div className="space-y-3">
                {myFeedback.map(fb => (
                  <div key={fb.id} className="bg-[#111] border border-gray-800 rounded-lg p-3">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-xs font-medium text-white line-clamp-1">{fb.title}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        fb.status === 'fixed' ? 'bg-green-500/10 text-green-400' :
                        fb.status === 'planned' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-gray-800 text-gray-400'
                      }`}>
                        {fb.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 flex justify-between">
                      <span>{fb.type} {fb.feature_slug ? `• ${features.find(f=>f.slug===fb.feature_slug)?.title || 'Feature'}` : ''}</span>
                      <span>{new Date(fb.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
                {myFeedback.length === 0 && (
                  <div className="text-sm text-gray-600 text-center py-6 border border-dashed border-gray-800 rounded-lg">
                    You haven't submitted any feedback yet.
                  </div>
                )}
              </div>
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}
