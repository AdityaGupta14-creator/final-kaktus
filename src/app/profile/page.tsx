'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Cpu, Calendar, CreditCard, Activity, ArrowLeft, MessageSquare, Database, ExternalLink, Plus, Sparkles } from 'lucide-react';
import { CHAT_SESSION_REGISTRY_KEY } from '@/lib/session-store';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  picture: string | null;
  createdAt: string | null;
  role: string;
  status: string;
  plan: string;
  isEarlyAccessMember?: boolean;
  subscription?: {
    planId: string;
    status: string;
    quotaRemaining: number;
    expiresAt: string | null;
    createdAt: string;
  } | null;
}

interface UsageInfo {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  modelBreakdown: Record<string, number>;
  history: Array<{
    id: string;
    model: string;
    success: boolean;
    durationMs: number;
    tokens: number;
    createdAt: string;
  }>;
}

interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: string;
}

interface ChatInfo {
  id: string;
  title: string;
  updatedAt: string;
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [chatsError, setChatsError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      if (!user) throw new Error('Not authenticated');
      setLoading(true);
      setError(null);
      
      const token = await user.getIdToken();
      const res = await fetch('/api/user/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('Failed to load profile data');
      }

      const json = await res.json();
      setProfile(json.profile);
      setUsage(json.usage);
      setUsageError(json.usageError || null);
      setProjects(json.projects || []);
      setProjectsError(json.projectsError || null);
      setChats(json.chats || []);
      setChatsError(json.chatsError || null);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError('Could not connect to the server to retrieve your account details.');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    loadData();
  }, [user, authLoading, router]);

  const handleReopenChat = (chatId: string) => {
    if (!user) return;
    // Set active chat session ID
    try {
      const rawRegistry = localStorage.getItem(CHAT_SESSION_REGISTRY_KEY(user.uid));
      let registry = rawRegistry ? JSON.parse(rawRegistry) : { version: 1, sessions: [] };
      registry.activeId = chatId;
      localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(user.uid), JSON.stringify(registry));
    } catch (e) {
      console.warn('Failed to update local session registry', e);
    }
    router.push('/ide');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-gray-200 flex items-center justify-center font-sans">
        <div className="animate-pulse text-gray-500 flex items-center gap-2">
          <Cpu className="animate-spin text-blue-500" size={16} /> Loading profile...
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-gray-200 p-8 font-sans">
        <div className="max-w-2xl mx-auto bg-red-900/20 border border-red-500/30 p-6 rounded-lg text-red-400">
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="mb-4">{error || 'An unknown error occurred.'}</p>
          <div className="flex items-center gap-4">
            <button 
              onClick={loadData}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              Retry Request
            </button>
            <Link href="/ide" className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
              <ArrowLeft size={14} /> Back to IDE
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 p-6 md:p-12 font-sans selection:bg-blue-500/30">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header navigation */}
        <div className="flex items-center justify-between pb-6 border-b border-white/5">
          <Link href="/ide" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back to IDE
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">My Account</h1>
        </div>

        {/* Account Overview */}
        <div className="bg-[#111111] border border-white/5 rounded-xl p-6 md:p-8 flex items-center gap-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 rounded-full flex items-center justify-center text-3xl font-bold uppercase overflow-hidden shadow-xl">
            {profile.picture ? (
              <img src={profile.picture} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              profile.name[0]
            )}
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-2xl font-bold text-white">{profile.name}</h2>
            <p className="text-gray-400">{profile.email}</p>
            <div className="flex flex-wrap items-center gap-4 mt-4 text-xs font-medium uppercase tracking-wider text-gray-500 pt-2">
              <span className="flex items-center gap-1"><Calendar size={12} /> Joined {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : 'Unknown'}</span>
              <span className="flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded-full border border-white/10 text-gray-300">{profile.role}</span>
              <span className="flex items-center gap-1"><CreditCard size={12} /> Plan: <span className="text-blue-400 font-bold">{profile.plan}</span></span>
              {profile.subscription && (
                <div className="flex items-center gap-4 border-l border-white/10 pl-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${profile.subscription.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                    {profile.subscription.status}
                  </span>
                  <span>Quota: <span className="text-white font-mono">{profile.subscription.quotaRemaining}</span></span>
                  {profile.subscription.expiresAt && (
                    <span className="flex items-center gap-1">
                      Expires: {new Date(profile.subscription.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 ml-auto border-l border-white/10 pl-6 md:pl-8">
            <Link href="/ide" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20">
              <Cpu size={16} /> Launch IDE
            </Link>

            {(profile.role === 'ADMIN' || profile.role === 'SUPER_ADMIN') && (
              <Link href="/admin" className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20">
                <Database size={16} /> Admin Panel
              </Link>
            )}
            
            {profile.isEarlyAccessMember && (
              <Link href="/early-access" className="px-5 py-2.5 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                <Sparkles size={16} /> Early Access
              </Link>
            )}

            <button 
              onClick={() => {
                // Clear active session to force a new project
                if (user) {
                  try {
                    const rawRegistry = localStorage.getItem(CHAT_SESSION_REGISTRY_KEY(user.uid));
                    let registry = rawRegistry ? JSON.parse(rawRegistry) : { version: 1, sessions: [] };
                    delete registry.activeId;
                    localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(user.uid), JSON.stringify(registry));
                  } catch (e) {}
                }
                router.push('/ide');
              }}
              className="px-5 py-2.5 bg-[#222] hover:bg-[#333] text-gray-200 text-sm font-semibold rounded-lg transition-colors border border-white/10 flex items-center justify-center gap-2"
            >
              <Plus size={16} /> New Project
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* API Usage Panel */}
          <div className="bg-[#111111] border border-white/5 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Activity size={14} /> Recent API Usage (Last 100)
              </h3>
            </div>
            
            {usageError && (
              <div className="bg-amber-900/20 text-amber-500 p-3 rounded-lg border border-amber-500/30 text-sm">
                Usage Data Unavailable: {usageError}
              </div>
            )}
            {usage && !usageError ? (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                    <div className="text-xs text-gray-500 uppercase">Requests</div>
                    <div className="text-xl font-medium text-gray-200">{usage.totalRequests}</div>
                  </div>
                  <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                    <div className="text-xs text-gray-500 uppercase">Tokens</div>
                    <div className="text-xl font-medium text-gray-200">{usage.totalTokens ? usage.totalTokens : 'Unknown'}</div>
                  </div>
                  <div className="bg-black/50 p-3 rounded-lg border border-white/5">
                    <div className="text-xs text-gray-500 uppercase">Failed</div>
                    <div className="text-xl font-medium text-red-400">{usage.failedRequests}</div>
                  </div>
                </div>

                {Object.keys(usage.modelBreakdown).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500 uppercase">Models</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(usage.modelBreakdown).map(([model, count]) => (
                        <div key={model} className="text-xs bg-white/5 px-2 py-1 rounded border border-white/10 text-gray-300">
                          {model} <span className="text-gray-500">({count})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500 py-4">No API usage recorded yet.</div>
            )}
          </div>

          {/* My Projects & Workspaces */}
          <div className="bg-[#111111] border border-white/5 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Database size={14} /> Projects
              </h3>
            </div>

            {projectsError && (
              <div className="bg-amber-900/20 text-amber-500 p-3 rounded-lg border border-amber-500/30 text-sm">
                Projects Data Unavailable: {projectsError}
              </div>
            )}

            {projects.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {projects.map(p => (
                  <button 
                    key={p.id} 
                    onClick={() => handleReopenChat(p.id)}
                    className="w-full group flex justify-between items-center p-3 rounded-lg bg-black/30 hover:bg-black/50 border border-white/5 hover:border-blue-500/30 transition-colors text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-200">{p.name}</div>
                      <div className="text-xs text-gray-500">{new Date(p.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <ExternalLink size={14} className="text-gray-600 group-hover:text-blue-400" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 py-4">No saved projects found. Check if your connection to Supabase is active.</div>
            )}
          </div>

          {/* My Chat History */}
          <div className="md:col-span-2 bg-[#111111] border border-white/5 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <MessageSquare size={14} /> Chat History
              </h3>
            </div>

            {chatsError && (
              <div className="bg-amber-900/20 text-amber-500 p-3 rounded-lg border border-amber-500/30 text-sm">
                Chats Data Unavailable: {chatsError}
              </div>
            )}

            {chats.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {chats.map(chat => (
                  <button 
                    key={chat.id} 
                    onClick={() => handleReopenChat(chat.id)}
                    className="flex flex-col text-left p-4 rounded-lg bg-black/30 hover:bg-blue-900/10 hover:border-blue-500/30 border border-white/5 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-start justify-between w-full">
                      <span className="text-sm font-medium text-gray-200 truncate pr-2" title={chat.title}>{chat.title}</span>
                      <ExternalLink size={12} className="text-gray-600 group-hover:text-blue-400 mt-0.5 flex-shrink-0" />
                    </div>
                    <span className="text-xs text-gray-500 mt-2">{new Date(chat.updatedAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 py-4">No saved chats found.</div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
