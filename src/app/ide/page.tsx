'use client';

import { useState, useRef, useCallback, useEffect, type ChangeEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatBox, ImplementationPlanCard } from '@/components/ChatBox';
import { ModelSelector } from '@/components/ModelSelector';
import type { TerminalRef } from '@/components/Terminal';
import type { TutorialData } from '@/components/CircuitCanvas';
import { TerminalSquare, X, Layers, Cpu, Cable, Zap, CircuitBoard, Usb, Settings, Upload, Trash2, Circle, LogOut, ShieldAlert, AlertTriangle, Download } from 'lucide-react';
import { FlashPanel } from '@/components/FlashPanel';
import { PdfGenerator } from '@/components/PdfGenerator';
import { extractProjectPlanResponse } from '@/lib/agent/protocol';
import type { PlanBuildAction, ProjectPlan, ResearchSource } from '@/lib/agent/protocol';
import { buildChatProjectMemory, insertStepsAfter, mergeCircuitSteps } from '@/lib/agent/workspace';
import { useAuth } from '@/components/AuthProvider';
import { getApiPool } from '@/lib/admin';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { syncToFirebase, loadFromFirebase } from '@/lib/firebase-sync';
import {
  CHAT_SESSION_REGISTRY_KEY,
  chatSessionKey,
  createChatSessionId,
  LEGACY_CHAT_KEY,
  LEGACY_WORKSPACE_KEY,
  normalizeSessionTitle,
  parseChatSessionRegistry,
  workspaceSessionKey,
  type ChatSessionSummary,
} from '@/lib/session-store';

interface WorkspaceTab {
  id: string;
  name: string;
  data: TutorialData | null;
  currentStep: number;
  kind?: 'circuit' | 'plan';
  plan?: ProjectPlan;
  sources?: ResearchSource[];
  planTargetTabId?: string;
  planApproved?: boolean;
  mergedFrom?: string[];
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
}

function emptyWorkspace(): WorkspaceState {
  return { tabs: [{ id: 'main', name: 'Main Assembly', data: null, currentStep: 0 }], activeTabId: 'main' };
}

function parseWorkspaceSnapshot(value: string | null): WorkspaceState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as WorkspaceState).tabs)) return null;
    const snapshot = parsed as WorkspaceState;
    if (!snapshot.tabs.length || !snapshot.tabs.every(tab => tab && typeof tab.id === 'string' && typeof tab.name === 'string')) return null;
    const activeTabId = snapshot.tabs.some(tab => tab.id === snapshot.activeTabId) ? snapshot.activeTabId : snapshot.tabs[0].id;
    return { tabs: snapshot.tabs, activeTabId };
  } catch {
    return null;
  }
}

function mergeWorkspaceTabIntoPrevious(state: WorkspaceState, sourceTabId: string): WorkspaceState {
  const sourceIndex = state.tabs.findIndex(tab => tab.id === sourceTabId && tab.kind !== 'plan');
  if (sourceIndex < 0 || sourceTabId === 'main') return state;
  const sourceTab = state.tabs[sourceIndex];
  if (!sourceTab.data) return state;

  const previousCircuitTab = state.tabs.slice(0, sourceIndex).reverse().find(tab => tab.kind !== 'plan');
  const fallbackTab = state.tabs.find(tab => tab.id === 'main' && tab.id !== sourceTabId);
  const targetTab = previousCircuitTab || fallbackTab;
  if (!targetTab || targetTab.id === sourceTabId) return state;

  const mergedSteps = mergeCircuitSteps(targetTab.data?.steps || [], sourceTab.data.steps || []);
  const sourceStepIndex = mergedSteps.sourceStepIndices[sourceTab.currentStep] ?? Math.max(0, mergedSteps.steps.length - 1);
  const sourceLineage = [...(sourceTab.mergedFrom || []), sourceTab.name];
  const mergedTab: WorkspaceTab = {
    ...targetTab,
    data: {
      project_name: targetTab.data?.project_name || sourceTab.data.project_name || targetTab.name,
      description: [targetTab.data?.description, sourceTab.data.description]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
        .join('\n\n'),
      blueprint_svg: targetTab.data?.blueprint_svg || sourceTab.data.blueprint_svg,
      steps: mergedSteps.steps,
    },
    currentStep: Math.min(sourceStepIndex, Math.max(0, mergedSteps.steps.length - 1)),
    mergedFrom: Array.from(new Set([...(targetTab.mergedFrom || []), ...sourceLineage])),
  };
  const tabs = state.tabs
    .filter(tab => tab.id !== sourceTabId)
    .map(tab => tab.id === targetTab.id ? mergedTab : tab);

  return { ...state, tabs, activeTabId: targetTab.id };
}

const Terminal = dynamic(() => import('@/components/Terminal').then((mod) => mod.Terminal), { ssr: false });
const CircuitCanvas = dynamic(() => import('@/components/CircuitCanvas').then((mod) => mod.CircuitCanvas), { ssr: false });

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, plan, planExpiresAt } = useAuth();
  let tokenLimit = 50000; // 50k for free
  if (plan === 'starter') tokenLimit = 150000;
  if (plan === 'booster') tokenLimit = 300000;
  if (plan === 'pro') tokenLimit = 1000000;
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; displayName?: string }>>([]);
  
  const [workspace, setWorkspace] = useState<WorkspaceState>(emptyWorkspace);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSaved, setLastSaved] = useState<string>('');
  const [totalTokens, setTotalTokens] = useState(0);
  const [isQuotaModalDismissed, setIsQuotaModalDismissed] = useState(false);
  const [isPdfGeneratorOpen, setIsPdfGeneratorOpen] = useState(false);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);


  useEffect(() => {
    const updateTokens = () => {
      try {
        const uid = localStorage.getItem('kaktus_user_uid');
        if (!uid) return;
        const usageRaw = localStorage.getItem(`gemini_key_usage_stats_${uid}`);
        if (usageRaw) {
          const usage = JSON.parse(usageRaw);
          let totalStoredTokens = 0;
          const today = new Date().toISOString().substring(0, 10); // 24-hour reset (daily)
          if (usage[today]) {
            for (const key in usage[today]) {
              for (const model in usage[today][key]) {
                totalStoredTokens += usage[today][key][model];
              }
            }
          }
          // Now usage reflects exact token count returned by Gemini API
          setTotalTokens(totalStoredTokens);
        } else {
          setTotalTokens(0);
        }
      } catch (e) {
        console.error(e);
      }
    };
    updateTokens();
    const interval = setInterval(updateTokens, 5000);
    window.addEventListener('geminiUsageUpdated', updateTokens);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('geminiUsageUpdated', updateTokens);
    };
  }, []);

  // Auto-save to Firebase with debounce (3 seconds after last change)
  const triggerAutoSave = useCallback(() => {
    if (!user?.uid || !workspaceReady) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      setIsSyncing(true);
      try {
        const registry = JSON.parse(localStorage.getItem(CHAT_SESSION_REGISTRY_KEY(user.uid)) || 'null');
        const workspaces: any = {};
        const chats: any = {};
        if (registry && registry.sessions) {
          registry.sessions.forEach((s: any) => {
            const ws = localStorage.getItem(workspaceSessionKey(s.id, user.uid));
            const chat = localStorage.getItem(chatSessionKey(s.id, user.uid));
            if (ws) workspaces[s.id] = JSON.parse(ws);
            if (chat) chats[s.id] = JSON.parse(chat);
          });
        }
        await syncToFirebase(user.uid, registry, workspaces, chats);
        setLastSaved(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      } catch { /* silent fail */ }
      finally { setIsSyncing(false); }
    }, 3000);
  }, [user?.uid, workspaceReady]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [pendingPlanAction, setPendingPlanAction] = useState<PlanBuildAction | null>(null);
  const [planImportStatus, setPlanImportStatus] = useState('');
  const planFileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenImplementationPlan = useCallback((plan: ProjectPlan, sources: ResearchSource[], tabId: string, requestedTargetTabId: string, focus = true) => {
    setWorkspace(prev => {
      const existing = prev.tabs.find(tab => tab.id === tabId);
      const targetTabId = prev.tabs.some(tab => tab.id === requestedTargetTabId && tab.kind !== 'plan')
        ? requestedTargetTabId
        : existing?.planTargetTabId || prev.tabs.find(tab => tab.id === 'main')?.id || 'main';
      const planTab: WorkspaceTab = {
        id: tabId,
        name: 'Implementation Plan',
        data: null,
        currentStep: 0,
        kind: 'plan',
        plan,
        sources,
        planTargetTabId: targetTabId,
        planApproved: existing?.planApproved || false,
      };
      const tabs = existing
        ? prev.tabs.map(tab => tab.id === tabId ? planTab : tab)
        : [...prev.tabs, planTab];
      return { tabs, activeTabId: focus ? tabId : prev.activeTabId };
    });
  }, []);

  const handlePlanActionConsumed = useCallback(() => setPendingPlanAction(null), []);

  useEffect(() => {
    if (authLoading) return;
    const init = async () => {
      if (user?.uid) await loadFromFirebase(user.uid);
      let nextSessionId = '';
      let nextSessions: ChatSessionSummary[] = [];
      try {
        const rawRegistry = localStorage.getItem(CHAT_SESSION_REGISTRY_KEY(user?.uid));
        const registry = rawRegistry ? parseChatSessionRegistry(JSON.parse(rawRegistry)) : null;
        if (registry) {
          nextSessionId = registry.activeId;
          nextSessions = [...registry.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
        } else {
          nextSessionId = createChatSessionId();
          nextSessions = [{ id: nextSessionId, title: 'New chat', updatedAt: Date.now() }];
        }

        const restored = parseWorkspaceSnapshot(localStorage.getItem(workspaceSessionKey(nextSessionId, user?.uid)));
        setWorkspace(restored || emptyWorkspace());
        setSessions(nextSessions);
        setSessionId(nextSessionId);
        localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(user?.uid), JSON.stringify({ version: 1, activeId: nextSessionId, sessions: nextSessions }));
      } catch { /* Ignore an unreadable workspace snapshot. */ }
      if (!nextSessionId) {
        nextSessionId = createChatSessionId();
        nextSessions = [{ id: nextSessionId, title: 'New chat', updatedAt: Date.now() }];
        setWorkspace(emptyWorkspace());
        setSessions(nextSessions);
        setSessionId(nextSessionId);
      }
      setWorkspaceReady(true);
    };
    init();
  }, [user?.uid, authLoading]);

  useEffect(() => {
    if (!workspaceReady || !sessionId) return;
    try { localStorage.setItem(workspaceSessionKey(sessionId, user?.uid), JSON.stringify(workspace)); } catch { /* Keep the active workspace usable if storage is full. */ }
    triggerAutoSave();
  }, [workspace, workspaceReady, sessionId]);

  useEffect(() => {
    if (!workspaceReady || !sessionId || !sessions.length) return;
    try {
      localStorage.setItem(CHAT_SESSION_REGISTRY_KEY(user?.uid), JSON.stringify({ version: 1, activeId: sessionId, sessions }));
    } catch { /* Keep saved sessions available in memory if storage is full. */ }
    triggerAutoSave();
  }, [sessions, sessionId, workspaceReady]);

  const startNewChat = useCallback(() => {
    if (!workspaceReady) return;
    const id = createChatSessionId();
    setSessions(previous => [{ id, title: 'New chat', updatedAt: Date.now() }, ...previous]);
    setSessionId(id);
    setWorkspace(emptyWorkspace());
    setPendingPlanAction(null);
  }, [workspaceReady]);

  const selectChatSession = useCallback((id: string) => {
    if (id === sessionId) return;
    const selected = sessions.find(session => session.id === id);
    if (!selected) return;
    const restored = parseWorkspaceSnapshot(localStorage.getItem(workspaceSessionKey(id, user?.uid)));
    setSessions(previous => previous.map(session => session.id === id ? { ...session, updatedAt: Date.now() } : session).sort((a, b) => b.updatedAt - a.updatedAt));
    setSessionId(id);
    setWorkspace(restored || emptyWorkspace());
    setPendingPlanAction(null);
  }, [sessionId, sessions]);

  const updateSessionActivity = useCallback((title?: string) => {
    setSessions(previous => previous.map(session => session.id === sessionId
      ? { ...session, title: title && session.title === 'New chat' ? normalizeSessionTitle(title) : session.title, updatedAt: Date.now() }
      : session).sort((a, b) => b.updatedAt - a.updatedAt));
  }, [sessionId]);

  const deleteChatSession = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    // First, clear from local storage
    try {
      localStorage.removeItem(chatSessionKey(id, user?.uid));
      localStorage.removeItem(workspaceSessionKey(id, user?.uid));
    } catch {}

    setSessions(previous => {
      const updated = previous.filter(s => s.id !== id);
      if (updated.length === 0) {
        const newId = createChatSessionId();
        setSessionId(newId);
        setWorkspace(emptyWorkspace());
        return [{ id: newId, title: 'New chat', updatedAt: Date.now() }];
      }
      
      if (id === sessionId) {
        setSessionId(updated[0].id);
        const restored = parseWorkspaceSnapshot(localStorage.getItem(workspaceSessionKey(updated[0].id, user?.uid)));
        setWorkspace(restored || emptyWorkspace());
        setPendingPlanAction(null);
      }
      return updated;
    });
  }, [sessionId]);
  
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isFlashOpen, setIsFlashOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('// Blink LED\nvoid setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n  digitalWrite(13, LOW);\n  delay(1000);\n}');
  const terminalRef = useRef<TerminalRef>(null);

  const [sidebarWidth, setSidebarWidth] = useState(340);
  const isDraggingSidebar = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      const newWidth = Math.max(260, Math.min(e.clientX, window.innerWidth * 0.6));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isDraggingSidebar.current) {
        isDraggingSidebar.current = false;
        document.body.style.cursor = 'default';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
  
    useEffect(() => {
      // First try to get Admin API Pool (App Global Keys)
      getApiPool().then(pool => {
        if (pool && pool.length > 0) {
          setApiKeys(pool.map(p => p.key));
        } else {
          // Fallback to local storage for backward compatibility
          const stored = localStorage.getItem('gemini_api_keys');
          if (stored) {
            try {
              setApiKeys(JSON.parse(stored));
            } catch(e) {}
          } else {
            const oldKey = localStorage.getItem('gemini_api_key');
            if (oldKey) setApiKeys([oldKey]);
          }
        }
      });
    }, []);
  

  const handleExecuteCommand = (cmd: string) => {
    if (!isTerminalOpen) setIsTerminalOpen(true);
    if (terminalRef.current) {
      terminalRef.current.sendCommand(cmd);
    }
  };

  const handleCircuitUpdate = useCallback((data: TutorialData, requestedTabId?: string) => {
    setWorkspace(prev => {
      const { tabs } = prev;
      let activeTabId = requestedTabId || prev.activeTabId;
      let action = data.action;
      
      // MERGE TAB logic: Git-style merge (replace main with branch)
      if (action === 'MERGE_TAB') {
        return mergeWorkspaceTabIntoPrevious(prev, activeTabId);
      }
      
      // NEW_TAB logic: Create fresh independent tab for a sub-system
      if (action === 'NEW_TAB') {
        const steps = data.steps || [];
        const hasContent = steps.some((s: any) => 
          (s.add_components && s.add_components.length > 0) || 
          (s.add_wiring && s.add_wiring.length > 0) ||
          s.code
        );
        const targetName = (data.target_tab || data.project_name || '').trim();
        const existingTargetIndex = targetName
          ? tabs.findIndex(tab => tab.kind !== 'plan' && tab.name.trim().toLowerCase() === targetName.toLowerCase())
          : -1;
        
        // GUARD: If AI sent empty NEW_TAB (no components/wires), fall through to UPDATE_CURRENT
        if (steps.length === 0 || !hasContent) {
          // Don't create empty tabs — treat as UPDATE_CURRENT on active tab
          action = 'UPDATE_CURRENT';
        } else if (existingTargetIndex >= 0) {
          activeTabId = tabs[existingTargetIndex].id;
          action = 'UPDATE_CURRENT';
        } else {
          const newTabData = {
            project_name: data.project_name || 'New Module',
            description: data.description || '',
            blueprint_svg: data.blueprint_svg,
            steps
          };
          
          const newId = 'tab_' + Date.now();
          return {
            ...prev,
            tabs: [...tabs, { 
              id: newId, 
              name: data.target_tab || data.project_name || 'New Module', 
              data: newTabData, 
              currentStep: 0
            }],
            activeTabId: newId
          };
        }
      }
      
      // Find target tab (by explicit target_tab name, or default to active)
      let targetIndex = activeTabId ? tabs.findIndex(t => t.id === activeTabId && t.kind !== 'plan') : 0;
      if (data.target_tab) {
        const foundIndex = tabs.findIndex(t => t.kind !== 'plan' && t.name.trim().toLowerCase() === data.target_tab?.trim().toLowerCase());
        if (foundIndex >= 0) targetIndex = foundIndex;
      }
      
      const targetTab = tabs[targetIndex];
      if (!targetTab || targetTab.kind === 'plan') return prev;
      
      // If it's a completely new project wipe
      if (action === 'NEW_PROJECT' || (data.project_name && targetTab.data?.project_name && data.project_name !== targetTab.data.project_name && data.project_name !== 'SAME_PROJECT' && !action)) {
        const updatedTabs = [...tabs];
        updatedTabs[targetIndex] = { ...targetTab, data, currentStep: 0, name: data.project_name || targetTab.name };
        return { ...prev, tabs: updatedTabs, activeTabId: targetTab.id };
      }
      
      // Incremental Update (UPDATE_CURRENT)
      if (!targetTab.data) {
        const updatedTabs = [...tabs];
        updatedTabs[targetIndex] = { ...targetTab, data, currentStep: 0, name: data.project_name || targetTab.name };
        return { ...prev, tabs: updatedTabs, activeTabId: targetTab.id };
      }
      
      const { steps: newSteps, firstInsertedIndex } = insertStepsAfter(targetTab.data.steps, data.steps);

      const mergedData = {
        ...targetTab.data,
        blueprint_svg: data.blueprint_svg || targetTab.data.blueprint_svg,
        steps: newSteps,
      };
      
      const updatedTabs = [...tabs];
      updatedTabs[targetIndex] = { ...targetTab, data: mergedData, currentStep: firstInsertedIndex };
      return { ...prev, tabs: updatedTabs, activeTabId: targetTab.id };
    });
  }, []);

  const handleStepChange = useCallback((step: number) => {
    setWorkspace(prev => {
      const tabs = [...prev.tabs];
      const idx = tabs.findIndex(t => t.id === prev.activeTabId);
      if (idx >= 0) {
        tabs[idx] = { ...tabs[idx], currentStep: step };
      }
      return { ...prev, tabs };
    });
  }, []);

  const activeTab = workspace.tabs.find(t => t.id === workspace.activeTabId) || workspace.tabs[0];
  const activeCircuitTab = activeTab.kind === 'plan'
    ? workspace.tabs.find(tab => tab.id === activeTab.planTargetTabId && tab.kind !== 'plan') || workspace.tabs.find(tab => tab.id === 'main') || workspace.tabs[0]
    : activeTab;
  const circuitData = activeCircuitTab.data;
  const currentStep = activeCircuitTab.currentStep;
  const totalSteps = circuitData?.steps?.length || 0;

  const handlePlanFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const extracted = extractProjectPlanResponse(await file.text());
      if (!extracted.plan) throw new Error('No valid implementation plan was found in that file.');
      handleOpenImplementationPlan(extracted.plan, [], 'implementation-plan', activeCircuitTab.id);
      setPlanImportStatus(`Imported ${file.name}`);
    } catch (error) {
      setPlanImportStatus(error instanceof Error ? error.message : 'Could not import this implementation plan.');
    } finally {
      event.target.value = '';
    }
  };

  // Compute stats for info panel
  const stats = circuitData ? (() => {
    let comps = 0, wires = 0;
    circuitData.steps.forEach(s => {
      comps += s.add_components?.length || 0;
      wires += s.add_wiring?.length || 0;
    });
    return { comps, wires };
  })() : null;

  // Compute all tabs summary with FULL component/wire detail for AI context
  const allTabs = workspace.tabs.filter(t => t.kind !== 'plan').map(t => {
    const componentMap = new Map<string, { id: string; type: string; x?: number; y?: number }>();
    const wireMap = new Map<string, { from: string; to: string; color?: string; net?: string; stepIndex: number }>();
    const wireKey = (from: string, to: string) => [from.toLowerCase(), to.toLowerCase()].sort().join('|');
    for (const [stepIndex, step] of (t.data?.steps || []).entries()) {
      for (const id of step.remove_components || []) {
        componentMap.delete(id);
        for (const [key, wire] of wireMap) {
          if (wire.from.startsWith(`${id}:`) || wire.to.startsWith(`${id}:`)) wireMap.delete(key);
        }
      }
      for (const removal of step.remove_wiring || []) {
        for (const [key, wire] of wireMap) {
          const remove = typeof removal === 'string'
            ? wire.from === removal || wire.to === removal
            : wireKey(wire.from, wire.to) === wireKey(removal.from, removal.to);
          if (remove) wireMap.delete(key);
        }
      }
      for (const component of step.add_components || []) {
        componentMap.set(component.id, { id: component.id, type: component.type, x: component.x, y: component.y });
      }
      for (const wire of step.add_wiring || []) {
        wireMap.set(wireKey(wire.from, wire.to), { from: wire.from, to: wire.to, color: wire.color, net: wire.net, stepIndex });
      }
    }
    const components = Array.from(componentMap.values());
    const wires = Array.from(wireMap.values());
    const pinLinks = new Map<string, Set<string>>();
    wires.forEach(wire => {
      for (const [endpoint, peer] of [[wire.from, wire.to], [wire.to, wire.from]]) {
        if (typeof endpoint !== 'string' || typeof peer !== 'string' || !endpoint.includes(':')) continue;
        const links = pinLinks.get(endpoint) || new Set<string>();
        links.add(peer);
        pinLinks.set(endpoint, links);
      }
    });
    return {
      name: t.name,
      isActive: t.id === activeCircuitTab.id,
      mergedFrom: t.mergedFrom || [],
      componentCount: components.length,
      wireCount: wires.length,
      stepCount: t.data?.steps?.length || 0,
      components,
      wires,
      pinAssignments: Array.from(pinLinks, ([pin, peers]) => `${pin} -> ${Array.from(peers).join(', ')}`),
      stepOutline: (() => {
        const outline = t.data?.steps?.map((step: any) => `${step.phase || 'Build'}: ${step.instruction}`) || [];
        const recentOutline = outline.length > 10
          ? [outline[0], `${outline.length - 9} earlier steps summarized`, ...outline.slice(-8)]
          : outline;
        return recentOutline.map((step: string) => step.length > 180 ? `${step.slice(0, 179).trimEnd()}…` : step);
      })()
    };
  });
  const projectMemory = buildChatProjectMemory(allTabs);

  if (!authLoading && !user) return null;

  return (
    <div className="min-h-screen h-screen bg-[#0a0a0a] text-gray-100 flex flex-col font-sans overflow-hidden dark-ui">
      {plan !== 'free' && planExpiresAt && new Date(planExpiresAt.getTime() - 3 * 24 * 60 * 60 * 1000) < new Date() && (
        <div className="bg-orange-500/10 text-orange-400 border-b border-orange-500/20 px-4 py-1.5 text-[12px] flex items-center justify-center gap-2 flex-shrink-0">
          <AlertTriangle size={14} />
          Your {plan.toUpperCase()} plan is ending soon. Renew to continue benefits.
          <Link href="/#pricing" className="underline font-medium hover:text-orange-300 ml-2">Renew now</Link>
        </div>
      )}
      {/* Top Navbar */}
      <header className="h-8 flex items-center justify-between pl-2 bg-[#181818] border-b border-[#2b2b2b] flex-shrink-0 select-none font-sans">
        {/* Left: Logo & Menu */}
        <div className="flex items-center h-full">
          <div className="w-8 h-full flex items-center justify-center mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="rainbowGrad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#eab308" />
                  <stop offset="50%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
              <g stroke="url(#rainbowGrad)">
                <path d="M12 22V4" />
                <path d="M12 14H9a2 2 0 0 1-2-2V8" />
                <path d="M12 10h3a2 2 0 0 0 2-2V5" />
              </g>
            </svg>
          </div>
          <nav className="hidden md:flex items-center text-[13px] text-[#cccccc] h-full gap-1 ml-2">
            <button className="px-3 h-full flex items-center hover:bg-[#333333] rounded-md transition-colors">
              File
            </button>
            {user && (
              <button 
                onClick={() => { window.location.href = '/'; setTimeout(() => signOut(auth), 100); }}
                className="px-2 h-full flex items-center hover:bg-red-950/40 text-gray-400 hover:text-red-400 rounded-md transition-colors gap-1 text-[12px]"
                title="Log out"
              >
                <LogOut size={12} />
                <span>Logout</span>
              </button>
            )}
            <button 
              onClick={() => setIsTerminalOpen(!isTerminalOpen)}
              className={`px-3 h-full flex items-center hover:bg-[#333333] rounded-md transition-colors ${isTerminalOpen ? 'bg-[#333333] text-white' : ''}`}
            >
              Terminal
            </button>
            <button 
              onClick={() => setIsFlashOpen(!isFlashOpen)}
              className={`px-3 h-full flex items-center hover:bg-[#333333] rounded-md transition-colors ${isFlashOpen ? 'bg-[#333333] text-white' : ''} gap-1.5`}
              title="Arduino Connection"
            >
              <Usb size={13} />
              Connect
            </button>
            <button 
              onClick={() => setIsPdfGeneratorOpen(true)}
              className="px-3 h-full flex items-center hover:bg-[#333333] rounded-md transition-colors gap-1.5 text-blue-400 hover:text-blue-300"
              title="Export as PDF"
            >
              <Download size={13} />
              Export PDF
            </button>
          </nav>
        </div>
        
        {/* Center: Title */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          <span className="text-gray-100 font-semibold tracking-wide text-sm">
            Kaktus
          </span>
          {stats ? (
            <div className="flex items-center gap-2 text-[10px] font-medium px-2 py-0.5 text-gray-400">
              <span className="flex items-center gap-1" title="Components"><Cpu size={10} className="text-gray-400" /> {stats.comps}</span>
              <span className="w-px h-3 bg-gray-700"></span>
              <span className="flex items-center gap-1" title="Connections"><Cable size={10} className="text-gray-400" /> {stats.wires}</span>
            </div>
          ) : null}
        </div>
        
        {/* Right: Actions */}
        <div className="flex items-center h-full pr-4 gap-3">
          {user && (
            <>
              {/* Token Usage Bar */}
              <div className="flex items-center gap-3 mr-2 bg-[#1a1a1a] px-3 py-1.5 rounded-md border border-[#333]">
                <div className="flex flex-col items-end w-28">
                  <div className="flex justify-between w-full mb-1">
                    <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">{plan === 'free' ? 'Free Trial' : 'Pro Plan'}</span>
                    <span className="text-[9px] text-blue-400 font-medium">{(totalTokens / 1000).toFixed(1)}k / {tokenLimit / 1000}k</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.min(100, (totalTokens / tokenLimit) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="w-px h-4 bg-gray-700 mx-1"></div>
              
              <div className="flex items-center gap-2 group relative">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shadow-sm">
                  {(user.displayName || user.email || "U")[0].toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] text-gray-200 font-medium hidden md:block max-w-[120px] truncate">
                    {user.email}
                  </span>
                  <span 
                    onClick={() => { window.location.href = '/'; setTimeout(() => signOut(auth), 100); }}
                    className="text-[9px] text-gray-500 hover:text-red-400 transition-colors uppercase tracking-widest hidden md:block cursor-pointer font-semibold"
                  >
                    Logout
                  </span>
                </div>
              </div>
              <div className="w-px h-4 bg-gray-700 mx-1"></div>
            </>
          )}
          <Link href="/admin" className="px-2 h-full flex items-center text-gray-400 hover:text-gray-200 hover:bg-[#333333] rounded transition-colors" title="Settings">
            <Settings size={14} />
          </Link>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden relative">
        
        {/* Left: Chat Pane */}
        <div 
          className="flex-shrink-0 bg-[#111] flex flex-col relative z-10"
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* Drag Handle */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-1 hover:w-1.5 bg-gray-800/40 hover:bg-blue-500/50 cursor-col-resize z-50 transition-colors"
            onMouseDown={() => {
              isDraggingSidebar.current = true;
              document.body.style.cursor = 'col-resize';
            }}
          />
          <div className="flex-1 overflow-hidden">
            {workspaceReady && sessionId && <ChatBox
              key={sessionId}
              apiKeys={apiKeys} 
              model={selectedModel}
              availableModels={availableModels}
              onModelChange={setSelectedModel}
              onExecuteCommand={handleExecuteCommand}
              onUpdateCircuit={handleCircuitUpdate}
              onStepChange={handleStepChange}
              currentStep={currentStep}
              totalSteps={circuitData?.steps?.length || 0}
              circuitData={circuitData}
              allTabs={allTabs}
              projectMemory={projectMemory}
              activeTabId={activeCircuitTab.id}
              targetWorkspaceTabId={activeTab.kind === 'plan' ? activeTab.planTargetTabId || 'main' : activeTab.id}
              sessionId={sessionId}
              sessionTitle={sessions.find(session => session.id === sessionId)?.title || 'New chat'}
              sessions={sessions}
              onNewChat={startNewChat}
              onSelectSession={selectChatSession}
              onUpdateSessionTitle={updateSessionActivity}
              onDeleteSession={deleteChatSession}
              onOpenImplementationPlan={handleOpenImplementationPlan}
              pendingPlanAction={pendingPlanAction}
              onPlanActionConsumed={handlePlanActionConsumed}
              onQuotaReached={() => setIsQuotaModalDismissed(false)}
              isQuotaReached={totalTokens >= tokenLimit}
              modelSelectorNode={<ModelSelector apiKey={apiKeys[0] || ''} selectedModel={selectedModel} onModelChange={setSelectedModel} onAvailableModelsChange={setAvailableModels} variant="minimal" />}
            />}
          </div>
        </div>

        {/* Center: Circuit Canvas & Tabs */}
        <div className="flex-1 flex flex-col relative bg-[#0a0a0a] overflow-hidden">
          {/* Tab Bar with Actions */}
          <div className="h-8 bg-[#111] border-b border-[#2b2b2b] flex items-stretch justify-between pl-0 overflow-x-auto select-none relative flex-shrink-0">
            {/* Left: Tabs */}
            <div className="flex items-stretch gap-0">
              {workspace.tabs.map(tab => (
                <div 
                  key={tab.id} 
                  onClick={() => setWorkspace(s => ({ ...s, activeTabId: tab.id }))}
                  className={`group flex items-center gap-2 px-4 rounded-t-md cursor-pointer text-xs transition-colors border-t border-l border-r ${
                    workspace.activeTabId === tab.id 
                      ? 'bg-[#0a0a0a] text-gray-100 border-[#2b2b2b] font-medium relative top-[1px] border-b-[#0a0a0a]' 
                      : 'bg-[#111] text-gray-500 border-transparent border-b-[#2b2b2b] hover:bg-[#1a1a1a] hover:text-gray-300'
                  }`}
                >
                  {tab.name}
                  
                  {/* Merge the branch into the previous circuit tab while preserving both histories. */}
                  {workspace.activeTabId === tab.id && tab.id !== 'main' && tab.kind !== 'plan' && tab.data && (
                    <button 
                      title="Merge into the previous circuit tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        setWorkspace(prev => mergeWorkspaceTabIntoPrevious(prev, tab.id));
                      }}
                      className="ml-2 text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                    >
                      Merge
                    </button>
                  )}
                </div>
              ))}
              
              {/* Add Tab Button */}
              <button 
                onClick={() => {
                  const newId = `sub-${Date.now()}`;
                  setWorkspace(prev => ({
                    tabs: [...prev.tabs, { id: newId, name: `Module ${prev.tabs.length}`, data: null, currentStep: 0 }],
                    activeTabId: newId
                  }));
                }}
                className="ml-1 my-1 px-2 rounded bg-transparent text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300 transition-colors flex items-center justify-center border border-transparent hover:border-gray-700"
                title="New Module Tab"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>

            
          </div>
          
          <div className="flex-1 relative overflow-hidden">
            {activeTab.kind === 'plan' && activeTab.plan ? (
              <div className="h-full overflow-y-auto p-5 md:p-8">
                <div className="mx-auto w-full max-w-4xl">
                  <ImplementationPlanCard
                    plan={activeTab.plan}
                    sources={activeTab.sources || []}
                    approved={activeTab.planApproved}
                    canApprove={apiKeys.length > 0 && !!selectedModel}
                    onApprove={(startApproach, phaseIndex) => {
                      setWorkspace(prev => ({
                        ...prev,
                        tabs: prev.tabs.map(tab => tab.id === activeTab.id ? { ...tab, planApproved: true } : tab),
                      }));
                      setPendingPlanAction({
                        id: `plan-action-${Date.now()}`,
                        plan: activeTab.plan!,
                        phaseIndex,
                        completedPhaseIndices: [],
                        targetTabId: activeTab.planTargetTabId || 'main',
                        startApproach,
                      });
                    }}
                  />
                </div>
              </div>
            ) : (
              <CircuitCanvas
    key={sessionId}
    data={circuitData}
    currentStep={currentStep}
    allTabs={allTabs}
    projectMemory={projectMemory}
    sessionId={sessionId}
    workspaceTabId={activeTab.id}
    onStepChange={handleStepChange}
    apiKeys={apiKeys}
    model={selectedModel}
    onUpdateCircuit={handleCircuitUpdate}
    onCompileRequest={(code) => {
      setGeneratedCode(code);
      setIsFlashOpen(true);
    }}
  />
            )}
          </div>
        </div>

        {/* Flash Panel */}
        <AnimatePresence>
          {isFlashOpen && (
            <FlashPanel 
              code={generatedCode}
              onClose={() => setIsFlashOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Right/Bottom: Sliding Terminal Drawer */}
        <AnimatePresence>
          {isTerminalOpen && (
            <motion.div 
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              style={{ left: sidebarWidth }}
              className="absolute bottom-0 right-0 z-40 flex h-[36vh] min-h-[220px] max-h-[380px] flex-col overflow-hidden border-l border-t border-gray-700/80 bg-[#111214] shadow-2xl"
            >
              <div className="h-9 shrink-0 border-b border-gray-800 bg-[#1b1c1f] flex items-center justify-between px-3">
                <div className="flex min-w-0 items-center gap-2 text-[11px]">
                  <TerminalSquare size={14} className="text-gray-400" />
                  <span className="font-medium text-gray-200">Terminal</span>
                  <span className="h-3 w-px bg-gray-700" />
                  <span className="flex items-center gap-1.5 truncate text-gray-500">Local PowerShell</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => terminalRef.current?.clear()}
                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
                    title="Clear terminal output"
                    aria-label="Clear terminal output"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button type="button" onClick={() => setIsTerminalOpen(false)} className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white" title="Close terminal" aria-label="Close terminal">
                  <X size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                 <Terminal ref={terminalRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Token Limit Modal */}
        <AnimatePresence>
          {totalTokens >= tokenLimit && !isQuotaModalDismissed && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#111111]/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="relative bg-[#1c1c1c] rounded-2xl p-8 max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col items-center text-center"
              >
                {/* Modal Stitching */}
                <div className="absolute inset-2 rounded-xl border border-dashed border-gray-700/60 pointer-events-none" />
                
                <button
                  onClick={() => setIsQuotaModalDismissed(true)}
                  className="absolute top-5 right-5 text-gray-600 hover:text-gray-400 transition-colors z-10"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
                
                <div className="relative w-16 h-16 bg-[#111] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] rounded-full flex items-center justify-center mb-5 mt-2">
                  {/* Icon Stitching */}
                  <div className="absolute inset-1.5 rounded-full border border-dashed border-red-900/40 pointer-events-none" />
                  <ShieldAlert className="w-6 h-6 text-red-500/90 z-10" strokeWidth={1.5} />
                </div>
                
                <h2 className="text-[22px] font-semibold text-[#f5f4e6] mb-3 tracking-wide">Daily Quota Reached</h2>
                <p className="text-[#9ca3af] mb-8 text-[15px] leading-relaxed px-2">
                  You have exceeded your {tokenLimit / 1000}k tokens limit for today.<br/>
                  Please upgrade your plan to continue chatting,<br/> building, and simulating.
                </p>
                
                <button
                  onClick={() => { window.location.href = '/#pricing'; }}
                  className="relative w-full py-3.5 px-4 bg-[#2b64d2] hover:bg-[#2353b3] text-white rounded-xl font-medium transition-all shadow-[0_4px_14px_0_rgba(43,100,210,0.39)] flex items-center justify-center gap-2 group overflow-hidden"
                >
                  {/* Button Stitching */}
                  <div className="absolute inset-[3px] rounded-lg border border-dashed border-white/20 pointer-events-none transition-colors group-hover:border-white/30" />
                  <span className="z-10 flex items-center gap-2 tracking-wide text-[15px]">
                    Upgrade Plan to Continue
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </span>
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <PdfGenerator
          isOpen={isPdfGeneratorOpen}
          onClose={() => setIsPdfGeneratorOpen(false)}
          circuitData={circuitData}
          sessionTitle={sessions.find(session => session.id === sessionId)?.title || 'New Project'}
          tabName={activeTab.name}
          sessionId={sessionId}
          workspaceTabId={activeTab.id}
        />

      </main>
    </div>
  );
}
