'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { 
  getAdminPaymentSettings, 
  updateAdminPaymentSettings, 
  getPendingPayments, 
  approvePayment, 
  rejectPayment, 
  PaymentTransaction, 
  PaymentSettings 
} from '@/lib/payments';
import { 
  Check, 
  X, 
  Loader2, 
  Upload, 
  QrCode, 
  Key, 
  Plus, 
  Trash2, 
  ShieldAlert, 
  ShieldCheck, 
  ArrowLeft,
  Activity,
  Power,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Users,
  Search,
  Filter,
  MoreVertical,
  Ban,
  Unlock,
  DollarSign,
  Sparkles
} from 'lucide-react';
import { 
  fetchAdminApiPool, 
  addAdminApiKey, 
  deleteAdminApiKey, 
  toggleAdminApiKey,
  testAdminApiKey,
  MaskedApiKeyData,
  fetchAdminUsers,
  assignUserRole,
  toggleUserSuspension,
  UserData
} from '@/lib/admin';
import Link from 'next/link';
import { UserInspectionDrawer } from './UserInspectionDrawer';
import { EarlyAccessManagement } from './EarlyAccessManagement';

export default function AdminPanel() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [userRole, setUserRole] = useState<string>('USER');
  const [inspectedUserId, setInspectedUserId] = useState<string | null>(null);

  const [settings, setSettings] = useState<PaymentSettings>({ upiId: '', upiQrUrl: '' });
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState('ALL');
  const [paymentsPage, setPaymentsPage] = useState(1);
  const PAYMENTS_PER_PAGE = 10;
  
  const filteredPayments = payments.filter(txn => {
    const searchMatch = !paymentsSearch || 
      (txn.txnId || '').toLowerCase().includes(paymentsSearch.toLowerCase()) || 
      (txn.email || '').toLowerCase().includes(paymentsSearch.toLowerCase()) ||
      (txn.uid || '').toLowerCase().includes(paymentsSearch.toLowerCase());
    const statusMatch = paymentsStatusFilter === 'ALL' || txn.status === paymentsStatusFilter;
    return searchMatch && statusMatch;
  });
  const totalPaymentPages = Math.ceil(filteredPayments.length / PAYMENTS_PER_PAGE);
  const paginatedPayments = filteredPayments.slice((paymentsPage - 1) * PAYMENTS_PER_PAGE, paymentsPage * PAYMENTS_PER_PAGE);

  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsSearch, paymentsStatusFilter]);
  const [apiKeys, setApiKeys] = useState<MaskedApiKeyData[]>([]);
  const [apiStats, setApiStats] = useState<any>(null);
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; text: string }>>({});
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const [users, setUsers] = useState<UserData[]>([]);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersRoleFilter, setUsersRoleFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [userActionLoading, setUserActionLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  const [auditSearch, setAuditSearch] = useState('');
  const [auditTypeFilter, setAuditTypeFilter] = useState('ALL');
  const [auditPage, setAuditPage] = useState(1);
  const AUDIT_PER_PAGE = 10;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Authenticate and verify admin authorization server-side
  const checkAdminStatus = useCallback(async () => {
    if (!user) {
      setAuthChecking(false);
      return;
    }

    try {
      setAuthChecking(true);
      const idToken = await user.getIdToken();
      setToken(idToken);

      const res = await fetch('/api/admin/auth/check', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setIsAuthorized(true);
        setUserRole(data.role || 'ADMIN');
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setIsAuthorized(false);
        setUserRole(data.role || 'USER');
      } else {
        setIsAuthorized(false);
      }
    } catch (err) {
      console.error('[Admin] Authorization check failed:', err);
      setIsAuthorized(false);
    } finally {
      setAuthChecking(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/admin');
    } else if (user) {
      checkAdminStatus();
    }
  }, [user, authLoading, router, checkAdminStatus]);

  // Load dashboard data once authorized
  const loadData = useCallback(async (idToken: string) => {
    try {
      const [settingsData, paymentsData, poolData, usersData, auditData] = await Promise.all([
        getAdminPaymentSettings().catch(() => ({ upiId: '', upiQrUrl: '' })),
        getPendingPayments(idToken).catch(() => []),
        fetchAdminApiPool(idToken).catch(() => ({ keys: [], stats: null, logs: [] })),
        fetchAdminUsers(idToken).catch(() => []),
        fetch('/api/admin/audit?limit=100', { headers: { Authorization: `Bearer ${idToken}` } })
          .then(res => res.json())
          .then(data => data.logs || [])
          .catch(() => []),
      ]);
      setSettings(settingsData);
      setPayments(paymentsData);
      setApiKeys(poolData.keys || []);
      setApiStats(poolData.stats || null);
      setUsers(usersData);
      setAuditLogs(auditData);
    } catch (err) {
      console.error('[Admin] Error loading administrative data:', err);
    }
  }, []);

  useEffect(() => {
    if (isAuthorized && token) {
      loadData(token);
    }
  }, [isAuthorized, token, loadData]);

  const handleAddApiKey = async () => {
    if (!newKey || !newLabel || !token) return;
    try {
      const updated = await addAdminApiKey(token, newKey, newLabel);
      setApiKeys(updated);
      setNewKey('');
      setNewLabel('');
    } catch (err: any) {
      alert(err.message || 'Failed to add API key.');
    }
  };

  const handleRemoveApiKey = async (keyId: string) => {
    if (!confirm('Remove this API key from the server pool?') || !token) return;
    try {
      const updated = await deleteAdminApiKey(token, keyId);
      setApiKeys(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to delete API key.');
    }
  };

  const handleToggleApiKey = async (keyId: string, currentEnabled: boolean) => {
    if (!token) return;
    try {
      const updated = await toggleAdminApiKey(token, keyId, !currentEnabled);
      setApiKeys(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to update key status.');
    }
  };

  const handleTestApiKey = async (keyId: string) => {
    if (!token) return;
    setTestingKeyId(keyId);
    try {
      const res = await testAdminApiKey(token, keyId);
      setTestResults(prev => ({
        ...prev,
        [keyId]: {
          success: res.success,
          text: res.success ? `✓ Passed (${res.latencyMs || 0}ms)` : `✗ Error: ${res.error || 'Failed'}`,
        },
      }));
      setApiKeys(res.keys);
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [keyId]: { success: false, text: `✗ ${err.message || 'Test failed'}` },
      }));
    } finally {
      setTestingKeyId(null);
    }
  };

  const loadPayments = async () => {
    if (!token) return;
    const data = await getPendingPayments(token);
    setPayments(data);
  };

  const handleSaveSettings = async () => {
    if (!token) return;
    setSavingSettings(true);
    try {
      await updateAdminPaymentSettings(settings, token);
      alert('Settings saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSettings({ ...settings, upiQrUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleApprove = async (txn: PaymentTransaction) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to approve this transaction and grant the ${txn.planId.toUpperCase()} plan to the user?`)) return;
    setActionLoading(txn.id);
    try {
      await approvePayment(txn, token);
      await loadPayments();
    } catch (e: any) {
      alert(e.message || 'Failed to approve payment.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (txnId: string) => {
    if (!confirm('Are you sure you want to reject this payment?') || !token) return;
    setActionLoading(txnId);
    try {
      await rejectPayment(txnId, token);
      await loadPayments();
    } catch (e: any) {
      alert(e.message || 'Failed to reject payment.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (targetUid: string, newRole: string) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    setUserActionLoading(true);
    try {
      await assignUserRole(token, targetUid, newRole);
      alert('Role updated successfully.');
      await loadData(token);
    } catch (err: any) {
      alert(err.message || 'Failed to change role.');
    } finally {
      setUserActionLoading(false);
    }
  };

  const handleSuspend = async (targetUid: string, suspend: boolean) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to ${suspend ? 'suspend' : 'restore'} this user?`)) return;
    setUserActionLoading(true);
    try {
      await toggleUserSuspension(token, targetUid, suspend, 'Admin Dashboard action');
      alert(`User ${suspend ? 'suspended' : 'restored'} successfully.`);
      await loadData(token);
    } catch (err: any) {
      alert(err.message || 'Failed to change suspension status.');
    } finally {
      setUserActionLoading(false);
    }
  };

  const [usersSort, setUsersSort] = useState<'date_desc'|'date_asc'>('date_desc');
  const [usersPage, setUsersPage] = useState(1);
  const USERS_PER_PAGE = 10;

  const filteredUsers = users.filter(u => {
    const searchMatch = !usersSearch || 
      (u.email || '').toLowerCase().includes(usersSearch.toLowerCase()) || 
      (u.displayName || '').toLowerCase().includes(usersSearch.toLowerCase());
    const roleMatch = usersRoleFilter === 'ALL' || u.role === usersRoleFilter;
    return searchMatch && roleMatch;
  }).sort((a, b) => {
    if (usersSort === 'date_desc') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (usersSort === 'date_asc') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return 0;
  });

  const totalPages = Math.ceil(filteredUsers.length / USERS_PER_PAGE);
  const paginatedUsers = filteredUsers.slice((usersPage - 1) * USERS_PER_PAGE, usersPage * USERS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => {
    setUsersPage(1);
  }, [usersSearch, usersRoleFilter, usersSort]);

  const filteredAuditLogs = auditLogs.filter(log => {
    const searchMatch = !auditSearch || 
      log.id.toLowerCase().includes(auditSearch.toLowerCase()) || 
      (log.details?.performedBy || '').toLowerCase().includes(auditSearch.toLowerCase()) ||
      (log.details?.targetEmail || '').toLowerCase().includes(auditSearch.toLowerCase());
    const typeMatch = auditTypeFilter === 'ALL' || log.type === auditTypeFilter;
    return searchMatch && typeMatch;
  });
  const totalAuditPages = Math.ceil(filteredAuditLogs.length / AUDIT_PER_PAGE);
  const paginatedAuditLogs = filteredAuditLogs.slice((auditPage - 1) * AUDIT_PER_PAGE, auditPage * AUDIT_PER_PAGE);

  useEffect(() => {
    setAuditPage(1);
  }, [auditSearch, auditTypeFilter]);

  if (authLoading || authChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-black">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-sm font-medium text-gray-600">Verifying administrative credentials...</p>
      </div>
    );
  }

  // 403 Forbidden Access State for non-admin users
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 text-black font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-gray-200 shadow-xl text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            You do not have administrative permissions to view this dashboard.
            <br />
            Signed in as: <strong className="font-mono text-gray-800">{user?.email || 'Unknown'}</strong>
            <br />
            Current role: <span className="inline-block mt-1 font-semibold text-xs px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 uppercase tracking-wide">{userRole}</span>
          </p>
          <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 text-left mb-6">
            <strong>Security Notice:</strong> Access requires verified <code className="font-mono font-bold">ADMIN</code> or <code className="font-mono font-bold">SUPER_ADMIN</code> role. If you are an administrator, ensure your email is added to <code className="font-mono">ADMIN_EMAILS</code> or assigned via Firebase Custom Claims.
          </div>
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
          <ShieldCheck className="text-blue-600 w-8 h-8" />
          <h1 className="text-xl font-bold">Admin Center</h1>
        </div>
        
        <nav className="flex flex-col gap-2 flex-1">
          <a href="#overview" className="flex items-center gap-3 px-4 py-3 bg-gray-100 text-blue-700 rounded-xl font-semibold transition-colors">
            <BarChart3 size={18} /> Overview
          </a>
          <a href="#users" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <Users size={18} /> Users & Roles
          </a>
          <a href="#payments" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <QrCode size={18} /> Payments
          </a>
          <a href="#api-pool" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <Key size={18} /> API Configuration
          </a>
          <a href="#audit-logs" className="flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-xl font-medium transition-colors">
            <Activity size={18} /> Audit Logs
          </a>
          {userRole === 'SUPER_ADMIN' && (
            <a href="#early-access" className="flex items-center gap-3 px-4 py-3 text-green-700 bg-green-50 hover:bg-green-100 rounded-xl font-medium transition-colors mt-2">
              <Sparkles size={18} /> Early Access
            </a>
          )}
        </nav>
        
        <div className="mt-auto pt-6 border-t border-gray-100">
          <div className="flex items-center gap-3 px-4 py-3">
             <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold uppercase">
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
        <div className="max-w-5xl mx-auto">
          
          {/* Overview Dashboard */}
          <div id="overview" className="mb-12 pt-4">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <BarChart3 className="text-blue-600" /> Dashboard Overview
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><Users size={16}/> Total Users</span>
                <span className="text-3xl font-bold text-gray-900">{users.length}</span>
                <span className="text-xs text-green-600 mt-2 font-medium bg-green-50 w-fit px-2 py-1 rounded-md">{users.filter(u => u.accountStatus === 'active').length} Active</span>
              </div>
              
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><CheckCircle2 size={16}/> PRO Subscriptions</span>
                <span className="text-3xl font-bold text-gray-900">{users.filter(u => u.planId === 'pro').length}</span>
                <span className="text-xs text-gray-500 mt-2 font-medium">Free: {users.filter(u => u.planId === 'free').length}</span>
              </div>
              
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><AlertTriangle size={16}/> Pending Payments</span>
                <span className="text-3xl font-bold text-gray-900">{payments.length}</span>
                <span className={`text-xs mt-2 font-medium w-fit px-2 py-1 rounded-md ${payments.length > 0 ? 'text-amber-700 bg-amber-50' : 'text-green-700 bg-green-50'}`}>
                  {payments.length > 0 ? 'Action required' : 'All caught up'}
                </span>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2"><Activity size={16}/> API Health</span>
                <span className="text-3xl font-bold text-gray-900">{apiStats?.healthyKeysCount ?? apiKeys.filter(k => k.status === 'healthy').length}</span>
                <span className="text-xs text-blue-600 mt-2 font-medium bg-blue-50 w-fit px-2 py-1 rounded-md">Healthy Keys</span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
               <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <h3 className="font-bold text-lg mb-4 text-gray-800">Recent Registrations</h3>
                  <div className="flex flex-col gap-3">
                     {users.slice(0, 4).map(u => (
                       <div key={u.uid} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{u.displayName || u.email || 'Unknown'}</p>
                            <p className="text-xs text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</p>
                          </div>
                          <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{u.planId}</span>
                       </div>
                     ))}
                     {users.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No users found</p>}
                  </div>
               </div>
               
               <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <h3 className="font-bold text-lg mb-4 text-gray-800">System Status</h3>
                  <div className="flex flex-col gap-3">
                     <div className="flex items-center gap-3 p-3 bg-green-50 text-green-800 rounded-xl">
                        <CheckCircle2 size={20} className="text-green-600"/>
                        <div>
                          <p className="text-sm font-semibold">Firebase Authentication</p>
                          <p className="text-xs opacity-80">Operational & Verifying tokens</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-3 p-3 bg-green-50 text-green-800 rounded-xl">
                        <CheckCircle2 size={20} className="text-green-600"/>
                        <div>
                          <p className="text-sm font-semibold">Supabase Synchronization</p>
                          <p className="text-xs opacity-80">Connected & Syncing workspaces</p>
                        </div>
                     </div>
                     <div className={`flex items-center gap-3 p-3 rounded-xl ${apiStats?.unhealthyKeysCount > 0 ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
                        {apiStats?.unhealthyKeysCount > 0 ? <AlertTriangle size={20} className="text-amber-600"/> : <CheckCircle2 size={20} className="text-green-600"/>}
                        <div>
                          <p className="text-sm font-semibold">Gemini API Pool</p>
                          <p className="text-xs opacity-80">{apiStats?.unhealthyKeysCount > 0 ? `${apiStats.unhealthyKeysCount} keys unhealthy` : 'All keys operational'}</p>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          </div>

        <div id="payments" className="mt-12 pt-8 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-6">
             <QrCode className="text-blue-600 w-8 h-8" />
             <h2 className="text-2xl font-bold">Payments & Subscriptions</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2">Pending Verifications</span>
                <span className="text-3xl font-bold text-gray-900">{payments.filter(p => p.status === 'pending').length}</span>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2">Approved Transactions</span>
                <span className="text-3xl font-bold text-gray-900">{payments.filter(p => p.status === 'approved').length}</span>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <span className="text-sm font-semibold text-gray-500 mb-1 flex items-center gap-2">Rejected Transactions</span>
                <span className="text-3xl font-bold text-gray-900">{payments.filter(p => p.status === 'rejected').length}</span>
             </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-6">
                 <h3 className="text-xl font-bold">Transactions</h3>
                 <div className="flex gap-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        value={paymentsSearch}
                        onChange={e => setPaymentsSearch(e.target.value)}
                        placeholder="Search UTR, Email..."
                        className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none text-sm"
                      />
                    </div>
                    <select
                      value={paymentsStatusFilter}
                      onChange={e => setPaymentsStatusFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none text-sm"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                 </div>
              </div>
              
              <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead className="bg-gray-50 border-b border-gray-200 text-sm">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-600">Reference (UTR)</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">User / Plan</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Date</th>
                      <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                      <th className="px-4 py-3 font-semibold text-gray-600 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-sm">
                     {paginatedPayments.length === 0 ? (
                       <tr>
                         <td colSpan={5} className="text-center py-12 text-gray-500">No transactions found.</td>
                       </tr>
                     ) : (
                       paginatedPayments.map(txn => (
                         <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                           <td className="px-4 py-3 font-mono text-xs">{txn.txnId}</td>
                           <td className="px-4 py-3">
                              <div className="flex flex-col">
                                 <span className="text-gray-900 font-medium">{txn.email || txn.uid}</span>
                                 <span className="text-xs font-bold text-blue-700 uppercase">{txn.planId}</span>
                              </div>
                           </td>
                           <td className="px-4 py-3 text-xs text-gray-500">
                             {txn.createdAt ? new Date(txn.createdAt).toLocaleString() : 'N/A'}
                           </td>
                           <td className="px-4 py-3">
                              {txn.status === 'pending' && <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded uppercase tracking-wide">Pending</span>}
                              {txn.status === 'approved' && <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded uppercase tracking-wide">Approved</span>}
                              {txn.status === 'rejected' && <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded uppercase tracking-wide">Rejected</span>}
                           </td>
                           <td className="px-4 py-3 text-right">
                              {txn.status === 'pending' && (
                                <div className="inline-flex gap-2">
                                  <button onClick={() => handleReject(txn.id)} disabled={actionLoading === txn.id} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Reject">
                                     {actionLoading === txn.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                                  </button>
                                  <button onClick={() => handleApprove(txn)} disabled={actionLoading === txn.id} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Approve">
                                     {actionLoading === txn.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                  </button>
                                </div>
                              )}
                           </td>
                         </tr>
                       ))
                     )}
                  </tbody>
                </table>
              </div>
              
              {/* Payments Pagination */}
              {totalPaymentPages > 1 && (
                <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-100">
                   <span className="text-sm text-gray-500">Page {paymentsPage} of {totalPaymentPages}</span>
                   <div className="flex gap-2">
                      <button onClick={() => setPaymentsPage(p => Math.max(1, p - 1))} disabled={paymentsPage === 1} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50">Prev</button>
                      <button onClick={() => setPaymentsPage(p => Math.min(totalPaymentPages, p + 1))} disabled={paymentsPage === totalPaymentPages} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50">Next</button>
                   </div>
                </div>
              )}
            </div>
            
            <div className="lg:col-span-1">
              {/* Settings Section */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm h-fit">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <QrCode className="text-blue-600 w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold">Payment Settings</h2>
                </div>
    
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Your UPI ID</label>
                    <input 
                      type="text" 
                      value={settings.upiId} 
                      onChange={e => setSettings({...settings, upiId: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 outline-none"
                      placeholder="e.g. shubham@okicici"
                    />
                  </div>
    
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">UPI QR Code</label>
                    {settings.upiQrUrl ? (
                      <div className="relative mb-2 inline-block">
                        <img src={settings.upiQrUrl} alt="QR" className="w-32 h-32 object-contain border border-gray-200 rounded-lg" />
                        <button onClick={() => setSettings({...settings, upiQrUrl: ''})} className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div onClick={() => fileInputRef.current?.click()} className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-500 cursor-pointer hover:bg-gray-50 transition-colors">
                        <Upload size={24} className="mb-2" />
                        <span className="text-xs">Upload QR</span>
                      </div>
                    )}
                    <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                  </div>
    
                  <button 
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center"
                  >
                    {savingSettings ? <Loader2 className="animate-spin w-5 h-5" /> : "Save Settings"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Users Management Section */}
        <div id="users" className="mt-12 pt-8 border-t border-gray-200 bg-white p-6 rounded-3xl shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                <Users className="text-indigo-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Users & Role Management</h2>
                <p className="text-sm text-gray-500">Manage user access, roles, and account statuses.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex flex-col text-right">
                <span className="text-xs text-gray-500 uppercase font-semibold">Total Users</span>
                <span className="font-bold text-lg">{users.length}</span>
              </div>
              <div className="flex flex-col text-right pl-4 border-l border-gray-200">
                <span className="text-xs text-gray-500 uppercase font-semibold">Suspended</span>
                <span className="font-bold text-lg">{users.filter(u => u.accountStatus === 'suspended').length}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                value={usersSearch}
                onChange={e => setUsersSearch(e.target.value)}
                placeholder="Search by email or name..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-200 outline-none text-sm"
              />
            </div>
            <div className="relative w-48">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <select
                value={usersRoleFilter}
                onChange={e => setUsersRoleFilter(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-200 outline-none text-sm appearance-none"
              >
                <option value="ALL">All Roles</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="ADMIN">ADMIN</option>
                <option value="EARLY_ACCESS">EARLY_ACCESS</option>
                <option value="FINANCE">FINANCE (Legacy)</option>
                <option value="SUPPORT">SUPPORT (Legacy)</option>
                <option value="USER">USER</option>
              </select>
            </div>
            <div className="relative w-48">
              <select
                value={usersSort}
                onChange={e => setUsersSort(e.target.value as any)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-200 outline-none text-sm appearance-none"
              >
                <option value="date_desc">Newest First</option>
                <option value="date_asc">Oldest First</option>
              </select>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-200 text-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">User</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Role</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Plan</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Registration</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                {paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12">
                       <div className="flex flex-col items-center justify-center text-gray-500">
                          <Users size={32} className="text-gray-300 mb-2"/>
                          <p className="font-semibold">No users found</p>
                          <p className="text-xs">Try adjusting your filters or search term</p>
                       </div>
                    </td>
                  </tr>
                ) : (
                  paginatedUsers.map((u) => (
                    <tr 
                      key={u.uid} 
                      className={`hover:bg-gray-50 transition-colors ${userRole === 'SUPER_ADMIN' ? 'cursor-pointer' : ''}`}
                      onClick={() => userRole === 'SUPER_ADMIN' && setInspectedUserId(u.uid)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-900">{u.displayName || 'No Name'}</span>
                          <span className="text-xs text-gray-500">{u.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {userRole === 'SUPER_ADMIN' ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                            disabled={userActionLoading || u.uid === user?.uid}
                            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50 font-semibold"
                          >
                            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="FINANCE">FINANCE</option>
                            <option value="SUPPORT">SUPPORT</option>
                            <option value="USER">USER</option>
                          </select>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-700">{u.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-[10px] font-mono uppercase bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{u.planId}</span>
                          {u.subscription && (
                            <div className="flex items-center gap-1.5 mt-1 border-t border-gray-100 pt-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${u.subscription.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                              <span className="text-[10px] font-medium text-gray-600">Q: {u.subscription.quotaRemaining}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.accountStatus === 'active' ? (
                          <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> Active
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-1 rounded-full inline-flex items-center gap-1">
                            <Ban size={12} /> Suspended
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {userRole === 'SUPER_ADMIN' && u.uid !== user?.uid && (
                            <button
                              onClick={() => handleSuspend(u.uid, u.accountStatus === 'active')}
                              disabled={userActionLoading}
                              className={`p-1.5 rounded-lg transition-colors inline-flex disabled:opacity-50 ${u.accountStatus === 'active' ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                              title={u.accountStatus === 'active' ? 'Suspend Account' : 'Restore Account'}
                            >
                              {u.accountStatus === 'active' ? <Ban size={15} /> : <Unlock size={15} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
                 <span className="text-sm text-gray-600">
                    Showing {(usersPage - 1) * USERS_PER_PAGE + 1} to {Math.min(usersPage * USERS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length} users
                 </span>
                 <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                      disabled={usersPage === 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded bg-white disabled:opacity-50 hover:bg-gray-50"
                    >
                      Previous
                    </button>
                    <span className="text-sm font-semibold">{usersPage} / {totalPages}</span>
                    <button 
                      onClick={() => setUsersPage(p => Math.min(totalPages, p + 1))}
                      disabled={usersPage === totalPages}
                      className="px-3 py-1 text-sm border border-gray-300 rounded bg-white disabled:opacity-50 hover:bg-gray-50"
                    >
                      Next
                    </button>
                 </div>
              </div>
            )}
          </div>
        </div>

        {/* API Pool & Infrastructure Section */}
        <div id="api-pool" className="mt-12 pt-8 border-t border-gray-200 bg-white p-6 rounded-3xl shadow-sm mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Key className="text-purple-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">API Key Pool & Infrastructure</h2>
                <p className="text-sm text-gray-500">Server-managed Gemini keys with automated rotation, failover, and health monitoring.</p>
              </div>
            </div>
          </div>

          {/* Infrastructure Metrics Overview */}
          {apiStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200">
                <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Total Requests</div>
                <div className="text-2xl font-bold font-mono text-gray-900">{apiStats.totalRequests || 0}</div>
              </div>
              <div className="p-4 bg-green-50/50 rounded-2xl border border-green-200">
                <div className="text-xs text-green-700 font-medium uppercase tracking-wider mb-1">Healthy Keys</div>
                <div className="text-2xl font-bold font-mono text-green-800">{apiStats.healthyKeysCount ?? apiKeys.filter(k => k.status === 'healthy').length}</div>
              </div>
              <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200">
                <div className="text-xs text-amber-700 font-medium uppercase tracking-wider mb-1">Rate Limited (429)</div>
                <div className="text-2xl font-bold font-mono text-amber-800">{apiStats.rateLimitedRequests || apiKeys.filter(k => k.status === 'rate_limited').length}</div>
              </div>
              <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-200">
                <div className="text-xs text-blue-700 font-medium uppercase tracking-wider mb-1">Success Rate</div>
                <div className="text-2xl font-bold font-mono text-blue-800">
                  {apiStats.totalRequests > 0 ? Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) : 100}%
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex gap-4 items-end bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Label (e.g. Production Key #1)</label>
                <input 
                  type="text" 
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="Production Key #1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-200 outline-none"
                />
              </div>
              <div className="flex-[2]">
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">API Key (Stored Server-Side)</label>
                <input 
                  type="password" 
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-200 outline-none font-mono text-sm"
                />
              </div>
              <button 
                onClick={handleAddApiKey}
                disabled={!newKey || !newLabel}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold px-6 py-2 rounded-lg transition-colors flex items-center gap-2 h-[42px]"
              >
                <Plus size={16} /> Add Key
              </button>
            </div>

            <div className="mt-4">
              {apiKeys.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                  <Key className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p>No API keys configured. Using server environment key if available, or add your first key above.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 text-sm">
                      <tr>
                        <th className="px-4 py-3 font-semibold text-gray-600">Provider & Label</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Masked Identifier</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Health Status</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Last Used</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Errors</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 text-sm">
                      {apiKeys.map((k) => (
                        <tr key={k.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider">
                                  {k.provider || 'Gemini'}
                                </span>
                                <span>{k.label}</span>
                                {!k.enabled && (
                                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.2 rounded font-mono">DISABLED</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500 tracking-wider">
                            {k.maskedKey}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              {k.status === 'healthy' && (
                                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1 w-fit">
                                  <CheckCircle2 size={12} /> Healthy
                                </span>
                              )}
                              {k.status === 'rate_limited' && (
                                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1 w-fit">
                                  <AlertTriangle size={12} /> Rate Limited
                                </span>
                              )}
                              {k.status === 'unhealthy' && (
                                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1 w-fit">
                                  <X size={12} /> Unhealthy
                                </span>
                              )}
                              {k.status === 'disabled' && (
                                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide inline-flex items-center gap-1 w-fit">
                                  Disabled
                                </span>
                              )}
                              {testResults[k.id] && (
                                <span className={`text-[11px] font-mono ${testResults[k.id].success ? 'text-green-600' : 'text-red-500'}`}>
                                  {testResults[k.id].text}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                             {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                          </td>
                          <td className="px-4 py-3 text-xs">
                             {(k.errorCount || 0) > 0 ? (
                               <div className="flex flex-col">
                                 <span className="text-red-600 font-semibold">{k.consecutiveFailures || 0} consecutive</span>
                                 <span className="text-gray-500">Total: {k.errorCount || 0}</span>
                               </div>
                             ) : (
                               <span className="text-gray-400">None</span>
                             )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {/* Test health button */}
                              <button
                                onClick={() => handleTestApiKey(k.id)}
                                disabled={testingKeyId === k.id}
                                className="text-blue-600 hover:text-blue-800 p-1.5 rounded-lg hover:bg-blue-50 transition-colors inline-flex"
                                title="Run live health test"
                              >
                                {testingKeyId === k.id ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}
                              </button>

                              {/* Toggle enable/disable button */}
                              <button
                                onClick={() => handleToggleApiKey(k.id, k.enabled)}
                                className={`p-1.5 rounded-lg transition-colors inline-flex ${k.enabled ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}
                                title={k.enabled ? 'Disable key' : 'Enable key'}
                              >
                                <Power size={15} />
                              </button>

                              {/* Delete button */}
                              <button 
                                onClick={() => handleRemoveApiKey(k.id)}
                                className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition-colors inline-flex"
                                title="Delete key"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Audit Logs Section */}
        <div id="audit-logs" className="mt-12 pt-8 border-t border-gray-200 bg-white p-6 rounded-3xl shadow-sm mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                <Activity className="text-slate-600 w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Audit Logs</h2>
                <p className="text-sm text-gray-500">Immutable security events and administrative actions.</p>
              </div>
            </div>
            
            <div className="flex gap-4">
               <div className="relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                 <input
                   type="text"
                   value={auditSearch}
                   onChange={e => setAuditSearch(e.target.value)}
                   placeholder="Search ID, email..."
                   className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-200 outline-none text-sm w-64"
                 />
               </div>
               <select
                 value={auditTypeFilter}
                 onChange={e => setAuditTypeFilter(e.target.value)}
                 className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-200 outline-none text-sm"
               >
                 <option value="ALL">All Event Types</option>
                 <option value="ROLE_ASSIGNED">Role Assignments</option>
                 <option value="ACCOUNT_SUSPENDED">Account Suspensions</option>
                 <option value="ACCOUNT_RESTORED">Account Restorations</option>
                 <option value="PAYMENT_APPROVED">Payments Approved</option>
                 <option value="PAYMENT_REJECTED">Payments Rejected</option>
                 <option value="API_KEY_ADDED">API Key Added</option>
                 <option value="API_KEY_DISABLED">API Key Disabled</option>
               </select>
            </div>
          </div>
          
          <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-200 text-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">Timestamp</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Event Type</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Actor (Performed By)</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Target & Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-sm">
                 {paginatedAuditLogs.length === 0 ? (
                   <tr>
                     <td colSpan={4} className="text-center py-12 text-gray-500">
                        {auditLogs.length === 0 ? "No historical audit logs found. Note: Logging began recently." : "No events match your filters."}
                     </td>
                   </tr>
                 ) : (
                   paginatedAuditLogs.map(log => (
                     <tr key={log.id} className="hover:bg-gray-50 transition-colors group">
                       <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                         {new Date(log.timestamp).toLocaleString()}
                         <div className="text-[10px] text-gray-400 font-mono mt-0.5">{log.id}</div>
                       </td>
                       <td className="px-4 py-3">
                         <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded">
                           {log.type}
                         </span>
                       </td>
                       <td className="px-4 py-3">
                          <span className="text-gray-800 font-medium">{log.details?.performedBy || 'System'}</span>
                       </td>
                       <td className="px-4 py-3 text-xs">
                          <div className="flex flex-col gap-1 max-w-md">
                             {log.details?.targetEmail && <span className="text-blue-600 font-medium">Target: {log.details.targetEmail}</span>}
                             {log.details?.paymentId && <span className="text-amber-700 font-mono">Payment: {log.details.paymentId}</span>}
                             {log.details?.assignedRole && <span>Granted Role: <strong className="uppercase">{log.details.assignedRole}</strong></span>}
                             {log.details?.reason && <span className="italic text-gray-500">Reason: "{log.details.reason}"</span>}
                             {log.type.includes('API_KEY') && log.details?.label && <span>Key: {log.details.label}</span>}
                             
                             <div className="hidden group-hover:block mt-2 p-2 bg-gray-100 rounded border border-gray-200">
                                <pre className="text-[10px] text-gray-600 overflow-x-auto">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                             </div>
                          </div>
                       </td>
                     </tr>
                   ))
                 )}
              </tbody>
            </table>
          </div>
          
          {totalAuditPages > 1 && (
            <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-100">
               <span className="text-sm text-gray-500">Page {auditPage} of {totalAuditPages}</span>
               <div className="flex gap-2">
                  <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50">Prev</button>
                  <button onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))} disabled={auditPage === totalAuditPages} className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50">Next</button>
               </div>
            </div>
          )}
        </div>

        {userRole === 'SUPER_ADMIN' && <EarlyAccessManagement />}
      </div>

      {inspectedUserId && (
        <UserInspectionDrawer 
          uid={inspectedUserId} 
          onClose={() => setInspectedUserId(null)} 
        />
      )}
    </div>
  );
}
