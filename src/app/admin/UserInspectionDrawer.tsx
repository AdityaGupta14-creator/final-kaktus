'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Database, MessageSquare, Activity, Calendar, ShieldCheck, Mail, AlertTriangle, Key } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

interface UserInspectionDrawerProps {
  uid: string;
  onClose: () => void;
}

export function UserInspectionDrawer({ uid, onClose }: UserInspectionDrawerProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'projects' | 'chats'>('overview');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/users/${uid}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load user data');
      }
      
      setData(json);
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading the user data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && uid) {
      loadData();
    }
  }, [user, uid]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-blue-600" /> User Inspection
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="animate-spin w-8 h-8 text-blue-600 mb-4" />
            <p>Loading user profile and history...</p>
          </div>
        ) : error ? (
          <div className="flex-1 p-8">
            <div className="bg-red-50 text-red-700 p-6 rounded-xl border border-red-200 flex flex-col items-center text-center">
              <AlertTriangle className="w-10 h-10 mb-4 text-red-500" />
              <h3 className="font-bold text-lg mb-2">Inspection Failed</h3>
              <p className="text-sm mb-4">{error}</p>
              <button 
                onClick={loadData}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Retry Request
              </button>
            </div>
          </div>
        ) : data ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
            
            {/* Header Profile Info */}
            <div className="bg-white p-6 border-b border-gray-200 shadow-sm flex items-start gap-6">
              <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-blue-50 border border-blue-100 rounded-full flex items-center justify-center text-3xl font-bold uppercase overflow-hidden flex-shrink-0 text-blue-800">
                {data.profile?.picture ? (
                  <img src={data.profile.picture} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  data.profile?.name?.[0] || 'U'
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-gray-900">{data.profile?.name || 'Unknown'}</h3>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase tracking-wide ${data.profile?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {data.profile?.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-gray-600">
                  <Mail size={14} /> <span className="text-sm">{data.profile?.email}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-700 rounded-md border border-gray-200 uppercase">{data.profile?.role}</span>
                  <span className="text-xs font-semibold px-2 py-1 bg-blue-50 text-blue-700 rounded-md border border-blue-100 uppercase">Plan: {data.profile?.plan}</span>
                  
                  {data.profile?.subscription && (
                    <>
                      <span className={`text-xs font-bold px-2 py-1 rounded-md uppercase tracking-wide ${data.profile.subscription.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {data.profile.subscription.status}
                      </span>
                      <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                        Quota: <strong className="text-gray-900">{data.profile.subscription.quotaRemaining}</strong>
                      </span>
                      {data.profile.subscription.expiresAt && (
                        <span className="text-xs text-gray-500">
                          Expires: {new Date(data.profile.subscription.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </>
                  )}
                  
                  <span className="text-xs text-gray-400 font-mono ml-auto" title="Firebase UID">{data.profile?.uid}</span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex px-6 bg-white border-b border-gray-200">
              <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>Overview</button>
              <button onClick={() => setActiveTab('usage')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'usage' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>API Usage</button>
              <button onClick={() => setActiveTab('projects')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'projects' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>Projects</button>
              <button onClick={() => setActiveTab('chats')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'chats' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>Chat History</button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
              
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                      <div className="text-xs text-gray-500 font-semibold uppercase flex items-center gap-1.5 mb-1"><Calendar size={14}/> Registration Date</div>
                      <div className="text-sm text-gray-900">{data.profile?.createdAt ? new Date(data.profile.createdAt).toLocaleString() : 'N/A'}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                      <div className="text-xs text-gray-500 font-semibold uppercase flex items-center gap-1.5 mb-1"><Activity size={14}/> Last Sign In</div>
                      <div className="text-sm text-gray-900">{data.profile?.lastSignInTime ? new Date(data.profile.lastSignInTime).toLocaleString() : 'N/A'}</div>
                    </div>
                  </div>
                  
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Key size={16}/> Recent Usage (Last 100)</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-center">
                        <div className="text-2xl font-bold text-gray-900">{data.usage?.totalRequests || 0}</div>
                        <div className="text-[10px] uppercase text-gray-500 font-semibold mt-1">API Requests</div>
                      </div>
                      <div className="bg-green-50 p-3 rounded-lg border border-green-100 text-center">
                        <div className="text-2xl font-bold text-green-700">{data.usage?.successfulRequests || 0}</div>
                        <div className="text-[10px] uppercase text-green-800 font-semibold mt-1">Successful</div>
                      </div>
                      <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-center">
                        <div className="text-2xl font-bold text-red-700">{data.usage?.failedRequests || 0}</div>
                        <div className="text-[10px] uppercase text-red-800 font-semibold mt-1">Failed</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'usage' && (
                <div className="space-y-6">
                  {data.usageError && (
                    <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-sm">Usage Data Unavailable</h4>
                        <p className="text-xs mt-1">{data.usageError}</p>
                      </div>
                    </div>
                  )}

                  {Object.keys(data.usage?.modelBreakdown || {}).length > 0 && (
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">Model Breakdown</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(data.usage.modelBreakdown).map(([model, count]) => (
                          <div key={model} className="bg-gray-100 border border-gray-200 text-gray-800 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
                            <span className="font-medium">{model}</span>
                            <span className="bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded font-bold">{String(count)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
                      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Recent Requests</h4>
                    </div>
                    {data.usage?.history?.length > 0 ? (
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                          <tr>
                            <th className="px-5 py-3 font-semibold">Time</th>
                            <th className="px-5 py-3 font-semibold">Model</th>
                            <th className="px-5 py-3 font-semibold">Tokens</th>
                            <th className="px-5 py-3 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.usage.history.map((log: any) => (
                            <tr key={log.id} className="hover:bg-gray-50">
                              <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                              <td className="px-5 py-3 font-medium text-gray-900">{log.model || 'Unknown'}</td>
                              <td className="px-5 py-3 text-gray-600">{log.tokens ? log.tokens : 'Unknown'}</td>
                              <td className="px-5 py-3">
                                {log.success ? (
                                  <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded">OK</span>
                                ) : (
                                  <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-1 rounded">ERR</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-gray-500 text-sm">No usage history found for this user.</div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'projects' && (
                <div className="space-y-4">
                  {data.projectsError && (
                    <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-sm">Supabase Unavailable</h4>
                        <p className="text-xs mt-1">{data.projectsError}</p>
                      </div>
                    </div>
                  )}

                  {data.projects?.length > 0 ? (
                    <div className="grid gap-3">
                      {data.projects.map((p: any) => (
                        <div key={p.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group">
                          <div>
                            <h5 className="font-bold text-gray-900 flex items-center gap-2"><Database size={14} className="text-blue-500"/> {p.name}</h5>
                            <p className="text-xs text-gray-500 mt-1">Updated: {new Date(p.updatedAt).toLocaleString()}</p>
                          </div>
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded border border-gray-200">{p.id.substring(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  ) : !data.projectsError && (
                    <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm text-center text-gray-500 flex flex-col items-center">
                      <Database className="w-10 h-10 text-gray-300 mb-3" />
                      <p className="font-semibold text-gray-900">No Projects Found</p>
                      <p className="text-sm mt-1">This user has not synced any workspaces.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'chats' && (
                <div className="space-y-4">
                  {data.chatsError && (
                    <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-sm">Supabase Unavailable</h4>
                        <p className="text-xs mt-1">{data.chatsError}</p>
                      </div>
                    </div>
                  )}

                  {data.chats?.length > 0 ? (
                    <div className="grid gap-3">
                      {data.chats.map((c: any) => (
                        <div key={c.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
                          <div>
                            <h5 className="font-bold text-gray-900 flex items-center gap-2"><MessageSquare size={14} className="text-indigo-500"/> {c.title}</h5>
                            <p className="text-xs text-gray-500 mt-1">Updated: {new Date(c.updatedAt).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !data.chatsError && (
                    <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm text-center text-gray-500 flex flex-col items-center">
                      <MessageSquare className="w-10 h-10 text-gray-300 mb-3" />
                      <p className="font-semibold text-gray-900">No Chats Found</p>
                      <p className="text-sm mt-1">This user has not saved any chat sessions.</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
