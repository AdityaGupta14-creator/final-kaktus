'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ShieldAlert, 
  ShieldCheck, 
  ArrowLeft,
  Activity,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  DollarSign,
  Download,
  Ban,
  RefreshCcw,
  Check
} from 'lucide-react';
import { PLANS } from '@/lib/server/plans';

export default function FinancePanel() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [userRole, setUserRole] = useState<string>('USER');
  const [token, setToken] = useState<string | null>(null);

  const [data, setData] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundingTxnId, setRefundingTxnId] = useState<string | null>(null);

  // Authenticate and verify authorization server-side
  const checkAuthStatus = useCallback(async () => {
    if (!user) {
      setAuthChecking(false);
      return;
    }

    try {
      setAuthChecking(true);
      const idToken = await user.getIdToken();
      setToken(idToken);

      const res = await fetch('/api/admin/auth/check', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (res.ok) {
        const authData = await res.json();
        // Allow FINANCE, ADMIN, SUPER_ADMIN
        if (['FINANCE', 'ADMIN', 'SUPER_ADMIN'].includes(authData.role)) {
          setIsAuthorized(true);
        } else {
          setIsAuthorized(false);
        }
        setUserRole(authData.role || 'USER');
      } else {
        setIsAuthorized(false);
      }
    } catch (err) {
      console.error('[Finance] Authorization check failed:', err);
      setIsAuthorized(false);
    } finally {
      setAuthChecking(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/finance');
    } else if (user) {
      checkAuthStatus();
    }
  }, [user, authLoading, router, checkAuthStatus]);

  const loadData = useCallback(async (idToken: string) => {
    try {
      const res = await fetch('/api/finance/data', {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('[Finance] Error loading data:', err);
    }
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    if (isAuthorized && token) {
      loadData(token);
    }
  }, [isAuthorized, token, loadData]);

  const filteredPayments = data?.payments?.filter((txn: any) => {
    const matchSearch = !searchQuery || 
      (txn.txnId || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (txn.email || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (txn.uid || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const isRefunded = txn.status === 'approved' && txn.refundedAt;
    const computedStatus = isRefunded ? 'refunded' : txn.status;
    const matchStatus = statusFilter === 'ALL' || computedStatus === statusFilter;

    return matchSearch && matchStatus;
  }) || [];

  const handleApprove = async (txn: any) => {
    if (!token) return;
    if (!confirm('Are you sure you want to approve this payment and grant subscription quota?')) return;
    setActionLoading(txn.id);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'approve', paymentId: txn.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Payment approved successfully.');
      await loadData(token);
    } catch (e: any) {
      alert(e.message || 'Failed to approve payment.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (txnId: string) => {
    if (!token) return;
    if (!confirm('Are you sure you want to reject this payment? It will not grant any quota.')) return;
    setActionLoading(txnId);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reject', paymentId: txnId }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Payment rejected successfully.');
      await loadData(token);
    } catch (e: any) {
      alert(e.message || 'Failed to reject payment.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefund = async (txnId: string) => {
    if (!token) return;
    if (!refundReason) {
      alert("Please provide a reason for the refund.");
      return;
    }
    if (!confirm('Are you sure you want to manually mark this payment as refunded? Ensure the actual refund is completed in the payment provider.')) return;
    
    setActionLoading('refund_' + txnId);
    try {
      const res = await fetch('/api/finance/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId: txnId, reason: refundReason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to issue refund.');
      }
      alert('Payment successfully marked as refunded.');
      setRefundingTxnId(null);
      setRefundReason('');
      await loadData(token);
    } catch (e: any) {
      alert(e.message || 'Failed to issue refund.');
    } finally {
      setActionLoading(null);
    }
  };

  const exportCSV = () => {
    if (!data?.payments) return;
    const headers = ['ID', 'UID', 'Email', 'Plan', 'Transaction ID', 'Status', 'Amount', 'Created At'];
    const rows = data.payments.map((p: any) => [
      p.id, p.uid, p.email, p.planId, p.txnId, p.status, PLANS[p.planId]?.price || 0, p.createdAt
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaktus-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (authLoading || authChecking) {
    return <div className="h-screen w-full flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div></div>;
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-gray-100">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            You do not have financial permissions to view this dashboard.
            <br />
            Signed in as: <strong className="font-mono text-gray-800">{user?.email || 'Unknown'}</strong>
            <br />
            Current role: <span className="inline-block mt-1 font-semibold text-xs px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 uppercase tracking-wide">{userRole}</span>
          </p>
          <Link
            href="/ide"
            className="w-full inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white font-medium py-3 rounded-xl transition-colors"
          >
            <ArrowLeft size={16} /> Return to IDE
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-[#111] font-sans flex">
      {/* Sidebar Navigation */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center gap-3 mb-10">
          <DollarSign className="text-green-600 w-8 h-8" />
          <h1 className="text-xl font-bold">Finance Center</h1>
        </div>
        
        <nav className="flex flex-col gap-2 flex-1">
          <a href="#overview" className="flex items-center gap-3 px-4 py-3 bg-gray-100 text-green-700 rounded-xl font-semibold transition-colors">
            <BarChart3 size={18} /> Overview
          </a>
          <a href="#transactions" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <QrCode size={18} /> Transactions
          </a>
          <a href="#subscriptions" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <Activity size={18} /> Subscriptions
          </a>
          <a href="#audit" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <ShieldCheck size={18} /> Audit Trail
          </a>
        </nav>
        
        <div className="mt-auto pt-6 border-t border-gray-100">
          <div className="flex items-center gap-3 px-4 py-3">
             <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold uppercase">
               {userRole[0]}
             </div>
             <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-semibold truncate">{user?.email}</span>
                <span className="text-xs text-gray-500">{userRole}</span>
             </div>
          </div>
          <Link href="/ide" className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={16} /> Return to IDE
          </Link>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-y-auto h-screen scroll-smooth">
        <div className="max-w-6xl mx-auto">
          {/* Overview Dashboard */}
          <div id="overview" className="mb-12 pt-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <BarChart3 className="text-green-600" /> Finance Overview
              </h2>
              <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors">
                <Download size={16} /> Export CSV
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><DollarSign size={16}/> Total Collected Revenue</span>
                <span className="text-3xl font-bold text-gray-900">${data?.overview?.totalRevenue || 0}</span>
                <span className="text-xs text-gray-500 mt-2 font-medium">Excludes refunded/rejected</span>
              </div>
              
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><CheckCircle2 size={16}/> Active Subscriptions</span>
                <span className="text-3xl font-bold text-gray-900">{data?.overview?.activeSubs || 0}</span>
                <span className="text-xs text-gray-500 mt-2 font-medium">Expired: {data?.overview?.expiredSubs || 0}</span>
              </div>
              
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><AlertTriangle size={16}/> Pending Revenue</span>
                <span className="text-3xl font-bold text-gray-900">${data?.overview?.pendingAmount || 0}</span>
                <span className={`text-xs mt-2 font-medium w-fit px-2 py-1 rounded-md ${data?.overview?.pendingRequests > 0 ? 'text-amber-700 bg-amber-50' : 'text-green-700 bg-green-50'}`}>
                  {data?.overview?.pendingRequests || 0} requests
                </span>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><RefreshCcw size={16}/> Refunded Transactions</span>
                <span className="text-3xl font-bold text-gray-900">{data?.overview?.refundedTx || 0}</span>
                <span className="text-xs text-gray-500 mt-2 font-medium">Manually marked</span>
              </div>
            </div>
          </div>

          <hr className="border-gray-200 mb-12" />

          {/* Transactions */}
          <div id="transactions" className="mb-12 pt-4">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <QrCode className="text-green-600" /> Transactions & Payments
            </h2>
            
            <div className="flex gap-4 mb-4">
              <input 
                type="text" 
                placeholder="Search by Transaction ID, Email, or UID..." 
                className="border border-gray-200 rounded-lg px-4 py-2 w-80 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select 
                className="border border-gray-200 rounded-lg px-4 py-2 text-sm bg-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-500">
                      <th className="p-4 font-semibold">User</th>
                      <th className="p-4 font-semibold">Plan / Amount</th>
                      <th className="p-4 font-semibold">Txn ID</th>
                      <th className="p-4 font-semibold">Date</th>
                      <th className="p-4 font-semibold">Status</th>
                      <th className="p-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPayments.map((txn: any) => (
                      <tr key={txn.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4">
                          <div className="font-medium text-gray-900">{txn.email || 'Unknown Email'}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5">{txn.uid}</div>
                        </td>
                        <td className="p-4">
                          <div className="font-medium capitalize text-gray-900">{txn.planId}</div>
                          <div className="text-sm text-gray-500">${PLANS[txn.planId]?.price || 0}</div>
                        </td>
                        <td className="p-4 text-sm font-mono text-gray-600">{txn.txnId || 'N/A'}</td>
                        <td className="p-4 text-sm text-gray-500">{new Date(txn.createdAt).toLocaleDateString()}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            txn.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                            txn.status === 'approved' ? (txn.refundedAt ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-green-50 text-green-700 border-green-200') : 
                            'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {txn.status === 'approved' && txn.refundedAt ? 'Refunded' : txn.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {txn.status === 'pending' && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleApprove(txn)}
                                disabled={actionLoading !== null}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Approve Payment"
                              >
                                {actionLoading === txn.id ? <span className="animate-spin block w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full" /> : <Check size={18} />}
                              </button>
                              <button
                                onClick={() => handleReject(txn.id)}
                                disabled={actionLoading !== null}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Reject Payment"
                              >
                                <Ban size={18} />
                              </button>
                            </div>
                          )}
                          {txn.status === 'approved' && !txn.refundedAt && (
                             <div className="flex flex-col items-end gap-2">
                               {refundingTxnId === txn.id ? (
                                 <div className="flex gap-2">
                                   <input type="text" placeholder="Reason..." value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className="border p-1 rounded text-sm w-32" />
                                   <button onClick={() => handleRefund(txn.id)} disabled={actionLoading !== null} className="bg-purple-600 text-white px-2 py-1 rounded text-xs">Confirm</button>
                                   <button onClick={() => setRefundingTxnId(null)} className="bg-gray-200 px-2 py-1 rounded text-xs">Cancel</button>
                                 </div>
                               ) : (
                                 <button onClick={() => setRefundingTxnId(txn.id)} className="text-xs text-purple-600 hover:underline">Issue Refund</button>
                               )}
                             </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!filteredPayments.length && (
                      <tr><td colSpan={6} className="p-8 text-center text-gray-500">No transactions found matching your criteria.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <hr className="border-gray-200 mb-12" />

          {/* Subscriptions */}
          <div id="subscriptions" className="mb-12 pt-4">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Activity className="text-green-600" /> Active Subscriptions
            </h2>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-500">
                      <th className="p-4 font-semibold">User UID</th>
                      <th className="p-4 font-semibold">Plan</th>
                      <th className="p-4 font-semibold">Quota Remaining</th>
                      <th className="p-4 font-semibold">Status</th>
                      <th className="p-4 font-semibold">Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data?.subscriptions?.map((sub: any) => (
                      <tr key={sub.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 font-mono text-sm">{sub.user_uid}</td>
                        <td className="p-4 font-medium capitalize">{sub.plan_id}</td>
                        <td className="p-4">{sub.quota_remaining}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${sub.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {sub.status}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-gray-500">{sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : 'Never'}</td>
                      </tr>
                    ))}
                    {!data?.subscriptions?.length && (
                      <tr><td colSpan={5} className="p-8 text-center text-gray-500">No subscriptions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <hr className="border-gray-200 mb-12" />

          {/* Audit Logs */}
          <div id="audit" className="mb-12 pt-4">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <ShieldCheck className="text-green-600" /> Finance Audit Trail
            </h2>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
               <div className="divide-y divide-gray-100">
                  {data?.auditLogs?.map((log: any) => (
                    <div key={log.id} className="p-4 flex flex-col gap-2 hover:bg-gray-50 transition-colors">
                       <div className="flex items-center justify-between">
                         <span className="font-semibold text-gray-900 text-sm">{log.type}</span>
                         <span className="text-xs text-gray-500">{new Date(log.timestamp).toLocaleString()}</span>
                       </div>
                       <div className="text-sm text-gray-700">
                         <strong>Actor:</strong> {log.actor?.email || log.actor?.uid} ({log.actor?.role})
                       </div>
                       <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto text-gray-600 mt-1 font-mono">
                         {JSON.stringify(log.details, null, 2)}
                       </pre>
                    </div>
                  ))}
                  {!data?.auditLogs?.length && (
                    <div className="p-8 text-center text-gray-500">No finance audit logs found.</div>
                  )}
               </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
