'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import { 
  ArrowLeft, Send, Lock, User, Clock, AlertTriangle, ShieldAlert
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function TicketDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [replyContent, setReplyContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const checkAuth = useCallback(async () => {
    if (!user) {
      if (!authLoading) router.push('/login?redirect=/support/tickets/' + id);
      return;
    }
    try {
      const tokenResult = await user.getIdTokenResult(true);
      const role = tokenResult.claims?.role || 'USER';
      
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
  }, [user, authLoading, router, id]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadData = useCallback(async (authToken: string) => {
    try {
      const res = await fetch(`/api/support/tickets/${id}`, { 
        headers: { Authorization: `Bearer ${authToken}` } 
      });
      
      if (res.ok) {
        const d = await res.json();
        setTicket(d.ticket);
        setMessages(d.messages || []);
      }
    } catch (e) {
      console.error("Failed to load ticket", e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (isAuthorized && token) {
      loadData(token);
    }
  }, [isAuthorized, token, loadData]);

  const handleSendReply = async () => {
    if (!replyContent.trim() || !token || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          content: replyContent,
          is_internal: isInternal
        })
      });
      if (res.ok) {
        setReplyContent('');
        await loadData(token);
      } else {
        alert("Failed to send message.");
      }
    } catch (e) {
      alert("Error sending message.");
    } finally {
      setIsSending(false);
    }
  };
  
  const updateTicketStatus = async (status: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/support/tickets/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        await loadData(token);
      }
    } catch (e) {}
  };

  if (authLoading || authChecking || loading) {
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
            You do not have permissions to view support tickets.
          </p>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-gray-100">
          <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Ticket Not Found</h1>
          <Link href="/support" className="text-orange-600 hover:underline">Return to Support Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Main Conversation Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 shrink-0 shadow-sm z-10">
          <Link href="/support" className="p-2 -ml-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{ticket.subject}</h1>
            <div className="text-xs text-gray-500 flex items-center gap-3 mt-1">
              <span>{ticket.email}</span>
              <span>•</span>
              <span>ID: {ticket.id}</span>
            </div>
          </div>
          <select 
            className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
            value={ticket.status}
            onChange={(e) => updateTicketStatus(e.target.value)}
          >
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Waiting for User">Waiting for User</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
        </header>

        {/* Conversation */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
          {messages.map((msg, i) => {
            const isAgent = msg.sender_uid !== ticket.user_uid;
            
            return (
              <motion.div 
                key={msg.id} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-4 max-w-3xl ${msg.is_internal ? 'mx-auto w-full' : isAgent ? 'ml-auto flex-row-reverse' : ''}`}
              >
                {!msg.is_internal && (
                  <div className={`w-8 h-8 rounded-full flex shrink-0 items-center justify-center mt-1 shadow-sm ${
                    isAgent ? 'bg-orange-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {isAgent ? <ShieldAlert size={14} /> : <User size={14} />}
                  </div>
                )}
                
                <div className={`flex-1 ${msg.is_internal ? '' : isAgent ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div className={`flex items-center gap-2 px-1 text-xs text-gray-500 ${msg.is_internal ? 'justify-center' : isAgent ? 'flex-row-reverse' : ''}`}>
                    <span className="font-medium text-gray-700">{msg.is_internal ? 'Internal Note' : msg.sender_email}</span>
                    <Clock size={12} />
                    <span>{new Date(msg.created_at).toLocaleString()}</span>
                  </div>
                  
                  <div className={`p-4 shadow-sm text-sm whitespace-pre-wrap leading-relaxed ${
                    msg.is_internal 
                      ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-xl w-full'
                      : isAgent 
                        ? 'bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tr-sm'
                        : 'bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-sm'
                  }`}>
                    {msg.is_internal && <div className="flex items-center gap-1.5 text-amber-600 font-medium mb-2 text-xs uppercase tracking-wider"><Lock size={12}/> Hidden from user</div>}
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Composer */}
        <div className="bg-white border-t border-gray-200 p-4 shrink-0 shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)]">
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            <div className="flex items-center gap-4 px-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-600 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isInternal} 
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="rounded text-orange-600 focus:ring-orange-500 w-4 h-4"
                />
                <Lock size={14} className={isInternal ? 'text-amber-500' : 'text-gray-400'} />
                Internal Note
              </label>
            </div>
            
            <div className="flex gap-2">
              <textarea 
                placeholder={isInternal ? "Write a private note (invisible to user)..." : "Write a reply to the user..."}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                className={`flex-1 border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 resize-none min-h-[100px] ${
                  isInternal ? 'bg-amber-50 border-amber-200 focus:ring-amber-500/20' : 'border-gray-200 focus:ring-orange-500/20 focus:border-orange-500'
                }`}
              />
              <button 
                onClick={handleSendReply}
                disabled={!replyContent.trim() || isSending}
                className={`px-6 rounded-xl font-medium text-white shadow-sm flex flex-col items-center justify-center gap-1 transition-colors ${
                  !replyContent.trim() || isSending ? 'bg-gray-300 cursor-not-allowed' : 
                  isInternal ? 'bg-amber-600 hover:bg-amber-500' : 'bg-orange-600 hover:bg-orange-500'
                }`}
              >
                <Send size={18} />
                <span className="text-xs">{isInternal ? 'Add Note' : 'Send'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Sidebar Info */}
      <div className="w-80 bg-white border-l border-gray-200 p-6 hidden lg:block overflow-y-auto">
        <h3 className="font-bold text-gray-900 mb-6 flex items-center gap-2">
          <AlertTriangle className="text-orange-500" size={18}/> 
          Ticket Details
        </h3>
        
        <div className="space-y-6">
          <div>
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Category</div>
            <div className="text-sm font-medium text-gray-900 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">{ticket.category}</div>
          </div>
          
          <div>
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Priority</div>
            <div className="text-sm font-medium text-gray-900 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">{ticket.priority}</div>
          </div>
          
          <div>
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Created</div>
            <div className="text-sm text-gray-900">{new Date(ticket.created_at).toLocaleString()}</div>
          </div>
          
          <div className="pt-6 border-t border-gray-100">
            <h4 className="font-semibold text-gray-900 mb-3 text-sm">Escalation</h4>
            <select className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">
              <option value="">No Escalation</option>
              <option value="Finance">Finance Team</option>
              <option value="Admin">Admin Team</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
