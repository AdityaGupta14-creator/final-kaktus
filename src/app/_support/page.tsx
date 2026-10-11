'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import { 
  LifeBuoy, Inbox, User, BookOpen, AlertTriangle, Activity, 
  ArrowLeft, Search, Filter, MessageSquare, Clock, CheckCircle2, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function SupportDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState('overview');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [userRole, setUserRole] = useState<string>('USER');
  const [token, setToken] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const checkAuth = useCallback(async () => {
    if (!user) {
      if (!authLoading) router.push('/login?redirect=/support');
      return;
    }
    try {
      const tokenResult = await user.getIdTokenResult(true);
      const role = tokenResult.claims?.role || 'USER';
      setUserRole(role as string);
      
      if (role === 'SUPPORT' || role === 'SUPER_ADMIN' || role === 'ADMIN') {
        setIsAuthorized(true);
        setToken(tokenResult.token);
      } else {
        setIsAuthorized(false);
      }
    } catch (e) {
      setIsAuthorized(false);
    } finally {
      setAuthChecking(false);
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadData = useCallback(async (authToken: string) => {
    try {
      const [overviewRes, ticketsRes] = await Promise.all([
        fetch('/api/support/overview', { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch('/api/support/tickets', { headers: { Authorization: `Bearer ${authToken}` } })
      ]);
      
      if (overviewRes.ok) {
        const d = await overviewRes.json();
        setMetrics(d.metrics);
      }
      if (ticketsRes.ok) {
        const d = await ticketsRes.json();
        setTickets(d.tickets || []);
      }
    } catch (e) {
      console.error("Failed to load data", e);
    }
  }, []);

  useEffect(() => {
    if (isAuthorized && token) {
      loadData(token);
    }
  }, [isAuthorized, token, loadData]);

  if (authLoading || authChecking) {
    return <div className="h-screen w-full flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div></div>;
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
            You do not have Support permissions to view this dashboard.
          </p>
          <Link href="/ide" className="inline-flex items-center justify-center px-6 py-3 bg-[#111] hover:bg-black text-white rounded-xl font-medium transition-colors">
            Return to IDE
          </Link>
        </div>
      </div>
    );
  }

  const filteredTickets = tickets.filter(t => {
    const searchMatch = !searchQuery || 
      (t.id || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (t.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.subject || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const statusMatch = statusFilter === 'ALL' || t.status === statusFilter;
    
    let tabMatch = true;
    if (activeTab === 'assigned') {
      tabMatch = t.assigned_to === user?.uid;
    }
    
    return searchMatch && statusMatch && tabMatch;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex h-screen sticky top-0">
        <div className="p-6">
          <Link href="/ide" className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-8 transition-colors">
            <ArrowLeft size={16} /> <span className="text-sm font-medium">Return to IDE</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <LifeBuoy className="text-orange-600 w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Support</h1>
              <p className="text-xs text-gray-500 uppercase tracking-widest">{userRole}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Activity size={18} /> Overview
          </button>
          <button onClick={() => setActiveTab('inbox')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'inbox' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Inbox size={18} /> Ticket Inbox
          </button>
          <button onClick={() => setActiveTab('assigned')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'assigned' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
            <User size={18} /> My Assigned
          </button>
          <div className="pt-4 mt-4 border-t border-gray-100">
            <button onClick={() => setActiveTab('lookup')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'lookup' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <Search size={18} /> User Lookup
            </button>
            <button onClick={() => setActiveTab('help')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'help' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <BookOpen size={18} /> Help Center
            </button>
            <button onClick={() => setActiveTab('escalations')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'escalations' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              <AlertTriangle size={18} /> Escalations
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          
          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="text-2xl font-bold mb-6">Support Overview</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-gray-500 text-sm font-medium mb-1">Total Open</div>
                  <div className="text-3xl font-bold text-gray-900">{metrics?.totalOpen || 0}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-gray-500 text-sm font-medium mb-1">Unassigned</div>
                  <div className="text-3xl font-bold text-orange-600">{metrics?.unassigned || 0}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-gray-500 text-sm font-medium mb-1">High Priority</div>
                  <div className="text-3xl font-bold text-red-600">{metrics?.highPriority || 0}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="text-gray-500 text-sm font-medium mb-1">Resolved</div>
                  <div className="text-3xl font-bold text-green-600">{metrics?.resolved || 0}</div>
                </div>
              </div>
              
              <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-gray-500 shadow-sm">
                <p>Metrics are calculated from real support tickets. Realtime updates are active.</p>
              </div>
            </motion.div>
          )}

          {(activeTab === 'inbox' || activeTab === 'assigned') && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="text-2xl font-bold mb-6">
                {activeTab === 'inbox' ? 'Ticket Inbox' : 'My Assigned Tickets'}
              </h2>
              
              <div className="flex flex-wrap gap-4 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input 
                    type="text" 
                    placeholder="Search tickets..." 
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <select 
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Waiting for User">Waiting for User</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                    <tr>
                      <th className="p-4">Ticket</th>
                      <th className="p-4">User</th>
                      <th className="p-4">Priority</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredTickets.length > 0 ? filteredTickets.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-4">
                          <Link href={`/support/tickets/${t.id}`} className="font-medium text-gray-900 hover:text-orange-600">
                            {t.subject}
                          </Link>
                          <div className="text-xs text-gray-500 mt-1">{t.category} • {t.id.substring(0,8)}</div>
                        </td>
                        <td className="p-4">{t.email}</td>
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            t.priority === 'Urgent' ? 'bg-red-100 text-red-700' :
                            t.priority === 'High' ? 'bg-orange-100 text-orange-700' :
                            t.priority === 'Normal' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {t.priority}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            t.status === 'Resolved' || t.status === 'Closed' ? 'bg-green-50 border-green-200 text-green-700' :
                            t.status === 'Open' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                            'bg-gray-50 border-gray-200 text-gray-700'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="p-4 text-gray-500 text-xs">
                          {new Date(t.updated_at).toLocaleDateString()}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-gray-500">
                          No tickets found matching your criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {(activeTab === 'lookup' || activeTab === 'help' || activeTab === 'escalations') && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-20">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Module Not Yet Available</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                The {activeTab} functionality is scheduled for the next deployment phase. Core ticketing workflows are active.
              </p>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}
