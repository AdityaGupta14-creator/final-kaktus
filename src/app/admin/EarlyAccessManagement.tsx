'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Sparkles, Users, Layers, MessageSquare, History, Loader2, CheckCircle2, Lock, Unlock } from 'lucide-react';

export function EarlyAccessManagement() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'members'|'features'|'feedback'>('members');
  
  const [members, setMembers] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Feature form state
  const [editingFeature, setEditingFeature] = useState<any>(null);
  const [savingFeature, setSavingFeature] = useState(false);

  const fetchMembers = async () => {
    const res = await fetch('/api/admin/early-access/members', { headers: { Authorization: `Bearer ${await user?.getIdToken()}` } });
    if (res.ok) setMembers((await res.json()).members || []);
  };

  const fetchFeatures = async () => {
    const res = await fetch('/api/admin/early-access/features', { headers: { Authorization: `Bearer ${await user?.getIdToken()}` } });
    if (res.ok) setFeatures((await res.json()).features || []);
  };

  const fetchFeedback = async () => {
    const res = await fetch('/api/admin/early-access/feedback', { headers: { Authorization: `Bearer ${await user?.getIdToken()}` } });
    if (res.ok) setFeedbacks((await res.json()).feedback || []);
  };

  useEffect(() => {
    if (!user) return;
    Promise.all([fetchMembers(), fetchFeatures(), fetchFeedback()]).then(() => setLoading(false));
  }, [user]);

  const grantAccess = async (uid: string, email: string) => {
    if (!confirm(`Grant early access to ${email}?`)) return;
    const res = await fetch('/api/admin/early-access/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user?.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'grant', uid, email })
    });
    if (res.ok) fetchMembers();
  };

  const revokeAccess = async (uid: string, email: string) => {
    if (!confirm(`Revoke early access from ${email}?`)) return;
    const res = await fetch('/api/admin/early-access/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user?.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', uid, email })
    });
    if (res.ok) fetchMembers();
  };

  const saveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFeature(true);
    const res = await fetch('/api/admin/early-access/features', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user?.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(editingFeature)
    });
    if (res.ok) {
      setEditingFeature(null);
      fetchFeatures();
    } else {
      alert('Failed to save feature.');
    }
    setSavingFeature(false);
  };

  const updateFeedbackStatus = async (id: string, status: string) => {
    const res = await fetch('/api/admin/early-access/feedback', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user?.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    if (res.ok) fetchFeedback();
  };

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 mt-12 mb-12" id="early-access">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <Sparkles className="text-green-600 w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Early Access Program</h2>
            <p className="text-sm text-gray-500">Manage members, release feature flags, and review tester feedback.</p>
          </div>
        </div>
      </div>

      <div className="flex gap-4 border-b border-gray-200 mb-6">
        <button onClick={() => setActiveTab('members')} className={`pb-3 px-2 font-medium text-sm transition-colors ${activeTab === 'members' ? 'border-b-2 border-green-600 text-green-700' : 'text-gray-500 hover:text-gray-900'}`}>Members</button>
        <button onClick={() => setActiveTab('features')} className={`pb-3 px-2 font-medium text-sm transition-colors ${activeTab === 'features' ? 'border-b-2 border-green-600 text-green-700' : 'text-gray-500 hover:text-gray-900'}`}>Features & Flags</button>
        <button onClick={() => setActiveTab('feedback')} className={`pb-3 px-2 font-medium text-sm transition-colors ${activeTab === 'feedback' ? 'border-b-2 border-green-600 text-green-700' : 'text-gray-500 hover:text-gray-900'}`}>Tester Feedback</button>
      </div>

      {activeTab === 'members' && (
        <div className="space-y-6">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex items-center gap-4">
             <input type="text" placeholder="Grant access by UID..." id="grantUid" className="flex-1 px-4 py-2 border rounded-lg" />
             <input type="text" placeholder="User Email (optional)" id="grantEmail" className="flex-1 px-4 py-2 border rounded-lg" />
             <button onClick={() => {
               const uid = (document.getElementById('grantUid') as HTMLInputElement).value;
               const email = (document.getElementById('grantEmail') as HTMLInputElement).value;
               if (uid) grantAccess(uid, email);
             }} className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700">Grant Access</button>
          </div>
          <table className="w-full text-left text-sm border-collapse">
            <thead><tr className="bg-gray-50 border-b border-gray-200"><th className="p-3">User UID</th><th className="p-3">Email</th><th className="p-3">Granted At</th><th className="p-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-gray-200">
              {members.map(m => (
                <tr key={m.user_uid}>
                  <td className="p-3 font-mono text-xs">{m.user_uid}</td>
                  <td className="p-3">{m.email}</td>
                  <td className="p-3 text-gray-500">{new Date(m.granted_at).toLocaleDateString()}</td>
                  <td className="p-3"><button onClick={() => revokeAccess(m.user_uid, m.email)} className="text-red-600 hover:underline">Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'features' && (
        <div className="space-y-6">
          {!editingFeature ? (
            <>
              <button onClick={() => setEditingFeature({ slug: '', title: '', status: 'coming_soon', access_mode: 'disabled' })} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium">Create Feature Flag</button>
              <div className="grid gap-4 mt-4">
                {features.map(f => (
                  <div key={f.slug} className="border border-gray-200 rounded-xl p-4 flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold">{f.title}</span>
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">{f.slug}</span>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded uppercase">{f.status}</span>
                      </div>
                      <p className="text-sm text-gray-500">{f.description}</p>
                      <div className="text-xs text-gray-400 mt-2">Access: {f.access_mode}</div>
                    </div>
                    <button onClick={() => setEditingFeature(f)} className="text-blue-600 hover:underline text-sm font-medium">Edit</button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={saveFeature} className="bg-gray-50 p-6 rounded-xl border border-gray-200 space-y-4">
              <h3 className="font-bold text-lg mb-4">{editingFeature.slug ? 'Edit Feature Flag' : 'New Feature Flag'}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Slug (ID)</label><input type="text" required value={editingFeature.slug} onChange={e=>setEditingFeature({...editingFeature, slug: e.target.value})} className="w-full px-3 py-2 border rounded-lg" disabled={!!features.find(f=>f.slug === editingFeature.slug)} /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Title</label><input type="text" required value={editingFeature.title} onChange={e=>setEditingFeature({...editingFeature, title: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Description</label><textarea required value={editingFeature.description||''} onChange={e=>setEditingFeature({...editingFeature, description: e.target.value})} className="w-full px-3 py-2 border rounded-lg" rows={2} /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                  <select value={editingFeature.status} onChange={e=>setEditingFeature({...editingFeature, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="coming_soon">Coming Soon</option><option value="testing">In Testing</option><option value="available">Available</option></select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Access Mode</label>
                  <select value={editingFeature.access_mode} onChange={e=>setEditingFeature({...editingFeature, access_mode: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="disabled">Disabled</option><option value="selected">Selected Members Only</option><option value="all_members">All Early Access Members</option></select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditingFeature(null)} className="px-4 py-2 text-gray-600 hover:text-gray-900">Cancel</button>
                <button type="submit" disabled={savingFeature} className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-black">Save Feature</button>
              </div>
            </form>
          )}
        </div>
      )}

      {activeTab === 'feedback' && (
        <div className="space-y-4">
          {feedbacks.map(fb => (
            <div key={fb.id} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2 bg-gray-50">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-gray-900">{fb.title}</h4>
                  <div className="text-xs text-gray-500 mt-0.5">From: {fb.email} • Feature: <span className="font-mono">{fb.feature_slug || 'General'}</span></div>
                </div>
                <select value={fb.status} onChange={e => updateFeedbackStatus(fb.id, e.target.value)} className="text-xs border-gray-300 rounded px-2 py-1 font-medium bg-white">
                  <option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="fixed">Fixed</option><option value="closed">Closed</option>
                </select>
              </div>
              <p className="text-sm text-gray-700 bg-white p-3 rounded border border-gray-100">{fb.description}</p>
            </div>
          ))}
          {feedbacks.length === 0 && <div className="text-center p-8 text-gray-500 border-2 border-dashed rounded-xl">No feedback submitted yet.</div>}
        </div>
      )}
    </div>
  );
}
