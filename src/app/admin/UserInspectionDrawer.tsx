'use client';

import { useState, useEffect } from 'react';
import { 
  X, 
  Loader2, 
  Database, 
  MessageSquare, 
  Activity, 
  Calendar, 
  ShieldCheck, 
  Mail, 
  AlertTriangle, 
  Key,
  RefreshCw,
  Cpu,
  Layers,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  BarChart2
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

interface UserInspectionDrawerProps {
  uid: string;
  onClose: () => void;
}

export function UserInspectionDrawer({ uid, onClose }: UserInspectionDrawerProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'projects' | 'chats'>('usage');
  const [daysFilter, setDaysFilter] = useState<'7' | '30' | 'all'>('30');
  const [updatingQuota, setUpdatingQuota] = useState(false);

  const handleQuotaModeChange = async (newMode: string) => {
    if (!user || !data) return;
    if (newMode === 'UNLIMITED') {
      const ok = window.confirm(
        'Confirm 500k Token Allowance:\n\n' +
        'This will apply an elevated 500k token / 500 run quota for this TEST account.\n' +
        'Provider rate limits, API key exhaustion, and safety controls will still be enforced.\n\n' +
        'Proceed with granting 500k allowance?'
      );
      if (!ok) return;
    }

    setUpdatingQuota(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/users/quota-mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid, quotaMode: newMode }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to update quota mode');
      }
      setData((prev: any) => ({
        ...prev,
        profile: {
          ...prev.profile,
          testQuotaMode: newMode,
        },
      }));
    } catch (err: any) {
      alert(err.message || 'Error updating quota mode');
    } finally {
      setUpdatingQuota(false);
    }
  };

  const loadData = async (filter: '7' | '30' | 'all' = daysFilter, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/users/${uid}?days=${filter}&limit=100`, {
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
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user && uid) {
      loadData(daysFilter);
    }
  }, [user, uid, daysFilter]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="relative w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 leading-tight">User Profile & API Usage</h2>
              <p className="text-xs text-gray-500 font-mono mt-0.5">UID: {uid}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(daysFilter, true)}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh usage data"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin text-blue-600' : ''} />
              <span>Refresh</span>
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-gray-50">
            <Loader2 className="animate-spin w-8 h-8 text-blue-600 mb-3" />
            <p className="text-sm font-medium">Retrieving real-time usage metrics...</p>
          </div>
        ) : error ? (
          <div className="flex-1 p-8 bg-gray-50">
            <div className="bg-red-50 text-red-700 p-6 rounded-xl border border-red-200 flex flex-col items-center text-center">
              <AlertTriangle className="w-10 h-10 mb-4 text-red-500" />
              <h3 className="font-bold text-lg mb-2">Inspection Request Failed</h3>
              <p className="text-sm mb-4">{error}</p>
              <button 
                onClick={() => loadData(daysFilter)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                Retry Request
              </button>
            </div>
          </div>
        ) : data ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
            
            {/* Header Profile Summary */}
            <div className="bg-white p-5 border-b border-gray-200 shadow-sm flex items-start gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-2xl font-bold uppercase overflow-hidden flex-shrink-0 text-white shadow-sm">
                {data.profile?.picture ? (
                  <img src={data.profile.picture} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  data.profile?.name?.[0] || 'U'
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xl font-bold text-gray-900 truncate">{data.profile?.name || 'Unknown User'}</h3>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${data.profile?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {data.profile?.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-gray-600 text-xs truncate">
                  <Mail size={13} className="text-gray-400 shrink-0" />
                  <span className="truncate">{data.profile?.email}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border uppercase ${data.profile?.role === 'TEST' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                    Role: {data.profile?.role}
                  </span>

                  {data.profile?.role === 'TEST' && (
                    <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-md">
                      <span className="text-xs font-semibold text-purple-900">Allowance:</span>
                      <select
                        value={data.profile?.testQuotaMode || 'HIGH'}
                        onChange={(e) => handleQuotaModeChange(e.target.value)}
                        disabled={updatingQuota}
                        className="text-xs font-bold border border-purple-300 rounded px-1.5 py-0.5 bg-white text-purple-900 focus:outline-none"
                      >
                        <option value="STANDARD">STANDARD (Plan Quota)</option>
                        <option value="HIGH">HIGH (500k Tokens / 500 Runs)</option>
                        <option value="UNLIMITED">TEST LIMIT (500k Tokens / 500 Runs)</option>
                      </select>
                      {updatingQuota && <Loader2 size={12} className="animate-spin text-purple-600" />}
                    </div>
                  )}

                  <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-100 uppercase">
                    Plan: {data.profile?.plan}
                  </span>
                  
                  {data.profile?.subscription && (
                    <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200">
                      Sub Runs: <strong className="text-gray-900">{data.profile.subscription.quotaRemaining}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex px-6 bg-white border-b border-gray-200">
              <button onClick={() => setActiveTab('usage')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'usage' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
                <Activity size={15} /> API Usage
              </button>
              <button onClick={() => setActiveTab('overview')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
                <Calendar size={15} /> Overview
              </button>
              <button onClick={() => setActiveTab('projects')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'projects' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
                <Database size={15} /> Projects ({data.projects?.length || 0})
              </button>
              <button onClick={() => setActiveTab('chats')} className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'chats' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
                <MessageSquare size={15} /> Chats ({data.chats?.length || 0})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
              
              {/* API USAGE TAB */}
              {activeTab === 'usage' && (
                <div className="space-y-6">
                  
                  {/* Time Range Filter Bar */}
                  <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                      <TrendingUp size={15} className="text-blue-600" />
                      <span>Reporting Window:</span>
                    </div>
                    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                      <button
                        onClick={() => setDaysFilter('7')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${daysFilter === '7' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        7 Days
                      </button>
                      <button
                        onClick={() => setDaysFilter('30')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${daysFilter === '30' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        30 Days
                      </button>
                      <button
                        onClick={() => setDaysFilter('all')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${daysFilter === 'all' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        All Time
                      </button>
                    </div>
                  </div>

                  {data.usageError && (
                    <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-sm">Supabase Usage Warning</h4>
                        <p className="text-xs mt-1">{data.usageError}</p>
                      </div>
                    </div>
                  )}

                  {/* 4 Primary Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Requests Card */}
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center justify-between">
                          <span>Total Requests</span>
                          <Activity size={14} className="text-blue-500" />
                        </div>
                        <div className="text-2xl font-bold text-gray-900 mt-2">
                          {(data.usage?.totalRequests || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
                        <span className="flex items-center gap-1 text-green-700 font-medium">
                          <CheckCircle2 size={11} /> {data.usage?.successfulRequests || 0} OK
                        </span>
                        <span className="flex items-center gap-1 text-red-600 font-medium">
                          <XCircle size={11} /> {data.usage?.failedRequests || 0} Err
                        </span>
                      </div>
                    </div>

                    {/* Tokens Card */}
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center justify-between">
                          <span>Total Tokens</span>
                          <Cpu size={14} className="text-purple-500" />
                        </div>
                        <div className="text-2xl font-bold text-purple-900 mt-2">
                          {(data.usage?.totalTokens || 0).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-gray-100 text-[11px] text-gray-500 truncate" title={`Prompt: ${(data.usage?.inputTokens || 0).toLocaleString()} | Output: ${(data.usage?.outputTokens || 0).toLocaleString()}`}>
                        <span>In: {(data.usage?.inputTokens || 0).toLocaleString()}</span>
                        <span className="mx-1">•</span>
                        <span>Out: {(data.usage?.outputTokens || 0).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Daily Quota Card */}
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center justify-between">
                          <span>Daily Quota</span>
                          <Layers size={14} className="text-indigo-500" />
                        </div>
                        <div className="text-2xl font-bold text-gray-900 mt-2">
                          {data.usage?.quota?.isUnlimited ? (
                            <span className="text-green-700">Unlimited</span>
                          ) : (
                            <span>{((data.usage?.quota?.dailyLimit || 0) / 1000).toFixed(0)}k</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-gray-100">
                        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                          <span>Used: {(data.usage?.quota?.dailyUsed || 0).toLocaleString()}</span>
                          <span className="font-semibold text-gray-700">{data.usage?.quota?.dailyPercentUsed || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${(data.usage?.quota?.dailyPercentUsed || 0) > 90 ? 'bg-red-500' : (data.usage?.quota?.dailyPercentUsed || 0) > 70 ? 'bg-amber-500' : 'bg-blue-600'}`}
                            style={{ width: `${Math.min(100, data.usage?.quota?.dailyPercentUsed || 0)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Estimated Cost Card */}
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase text-gray-500 flex items-center justify-between">
                          <span>Est. Cost (USD)</span>
                          <DollarSign size={14} className="text-emerald-500" />
                        </div>
                        <div className="text-2xl font-bold text-emerald-700 mt-2">
                          ${typeof data.usage?.estimatedCostUsd === 'number' ? data.usage.estimatedCostUsd.toFixed(4) : '0.0000'}
                        </div>
                      </div>
                      <div className="mt-3 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
                        <span>Standard Gemini Rates</span>
                      </div>
                    </div>
                  </div>

                  {/* Model Distribution */}
                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-2">
                      <BarChart2 size={16} className="text-blue-600" /> Model Consumption Breakdown
                    </h4>

                    {Object.keys(data.usage?.modelBreakdown || {}).length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(data.usage.modelBreakdown).map(([model, info]: [string, any]) => (
                          <div key={model} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-gray-900">{model}</span>
                                <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded">
                                  {info.requests} req{info.requests === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-bold text-gray-900">{(info.tokens || 0).toLocaleString()} tokens</span>
                                <span className="text-xs text-gray-500 ml-2">({info.percentage || 0}%)</span>
                                {typeof info.costUsd === 'number' && info.costUsd > 0 && (
                                  <span className="text-xs font-mono text-emerald-700 ml-2">${info.costUsd.toFixed(4)}</span>
                                )}
                              </div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full"
                                style={{ width: `${Math.min(100, Math.max(2, info.percentage || 0))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-sm text-gray-500">
                        No model breakdown recorded in this reporting window.
                      </div>
                    )}
                  </div>

                  {/* Daily Activity History */}
                  {data.usage?.dailyBreakdown?.length > 0 && (
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-3 flex items-center gap-2">
                        <Calendar size={16} className="text-indigo-600" /> Daily Activity History
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Date</th>
                              <th className="px-3 py-2 font-semibold">Requests</th>
                              <th className="px-3 py-2 font-semibold">Tokens</th>
                              <th className="px-3 py-2 font-semibold">Est. Cost</th>
                              <th className="px-3 py-2 font-semibold">Active Models</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.usage.dailyBreakdown.map((day: any) => (
                              <tr key={day.date} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-semibold text-gray-900">{day.date}</td>
                                <td className="px-3 py-2 text-gray-700">{day.requests}</td>
                                <td className="px-3 py-2 font-mono text-gray-800">{(day.tokens || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 font-mono text-emerald-700">${typeof day.costUsd === 'number' ? day.costUsd.toFixed(4) : '0.0000'}</td>
                                <td className="px-3 py-2 text-gray-600">
                                  {Object.keys(day.models || {}).map(m => (
                                    <span key={m} className="inline-block bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] mr-1 mb-1">
                                      {m}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Granular Recent Requests Log */}
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide flex items-center gap-1.5">
                        <Clock size={14} className="text-blue-600" /> Recent Granular Requests
                      </h4>
                      <span className="text-xs text-gray-500">
                        {data.usage?.history?.length || 0} recorded
                      </span>
                    </div>

                    {data.usage?.history?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase">
                            <tr>
                              <th className="px-4 py-2.5 font-semibold">Time</th>
                              <th className="px-4 py-2.5 font-semibold">Model</th>
                              <th className="px-4 py-2.5 font-semibold">Tokens (In / Out)</th>
                              <th className="px-4 py-2.5 font-semibold">Latency</th>
                              <th className="px-4 py-2.5 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.usage.history.map((log: any) => (
                              <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                                  {new Date(log.timestamp).toLocaleString()}
                                </td>
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  <span className="bg-gray-100 px-2 py-0.5 rounded font-mono text-[11px] border border-gray-200">
                                    {log.model}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-gray-700 font-mono">
                                  <span>{(log.tokens || 0).toLocaleString()}</span>
                                  {(log.inputTokens > 0 || log.outputTokens > 0) && (
                                    <span className="text-[10px] text-gray-400 ml-1.5">
                                      ({log.inputTokens} / {log.outputTokens})
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-gray-500 font-mono">
                                  {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {log.status === 'SUCCESS' ? (
                                    <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded inline-flex items-center gap-1">
                                      <CheckCircle2 size={10} /> OK
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded inline-flex items-center gap-1" title={log.errorType || 'Request Failed'}>
                                      <XCircle size={10} /> {log.errorType || 'ERR'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-gray-500 flex flex-col items-center">
                        <Key className="w-8 h-8 text-gray-300 mb-2" />
                        <p className="font-medium text-sm text-gray-700">No usage recorded</p>
                        <p className="text-xs text-gray-400 mt-1">This user has not made any recorded AI API requests in this window.</p>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                      <div className="text-xs text-gray-500 font-semibold uppercase flex items-center gap-1.5 mb-1">
                        <Calendar size={14}/> Registration Date
                      </div>
                      <div className="text-sm text-gray-900 font-medium">
                        {data.profile?.createdAt ? new Date(data.profile.createdAt).toLocaleString() : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                      <div className="text-xs text-gray-500 font-semibold uppercase flex items-center gap-1.5 mb-1">
                        <Activity size={14}/> Last Sign In
                      </div>
                      <div className="text-sm text-gray-900 font-medium">
                        {data.profile?.lastSignInTime ? new Date(data.profile.lastSignInTime).toLocaleString() : 'N/A'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Activity size={16} className="text-blue-600" /> Account Status & Quota Summary
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 text-center">
                        <div className="text-2xl font-bold text-gray-900">{data.usage?.totalRequests || 0}</div>
                        <div className="text-[10px] uppercase text-gray-500 font-semibold mt-1">Total Requests</div>
                      </div>
                      <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-center">
                        <div className="text-2xl font-bold text-purple-900">{(data.usage?.totalTokens || 0).toLocaleString()}</div>
                        <div className="text-[10px] uppercase text-purple-800 font-semibold mt-1">Total Tokens</div>
                      </div>
                      <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 text-center">
                        <div className="text-2xl font-bold text-emerald-700">
                          ${typeof data.usage?.estimatedCostUsd === 'number' ? data.usage.estimatedCostUsd.toFixed(4) : '0.0000'}
                        </div>
                        <div className="text-[10px] uppercase text-emerald-800 font-semibold mt-1">Est. AI Spend</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PROJECTS TAB */}
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
                            <h5 className="font-bold text-gray-900 flex items-center gap-2">
                              <Database size={14} className="text-blue-500"/> {p.name}
                            </h5>
                            <p className="text-xs text-gray-500 mt-1">Updated: {new Date(p.updatedAt).toLocaleString()}</p>
                          </div>
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded border border-gray-200">
                            {p.id.substring(0, 8)}
                          </span>
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

              {/* CHATS TAB */}
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
                            <h5 className="font-bold text-gray-900 flex items-center gap-2">
                              <MessageSquare size={14} className="text-indigo-500"/> {c.title}
                            </h5>
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
