'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { Move, CheckCircle2, ChevronLeft, ChevronRight, ChevronUp, Play, ZoomIn, ZoomOut, Maximize, Send, Loader2, MessageCircle, X, SkipBack, Search, Zap } from 'lucide-react';
import { requestAgent } from '@/lib/agent/client';
// system-prompt not used here; canvas chat uses contextPrompt directly
import { extractTutorialResponse, cleanAgentText } from '@/lib/agent/protocol';
import { buildHardwareStudioSystemPrompt } from '@/lib/agent/system-prompt';
import { compactConversationContext } from '@/lib/agent/context-compaction';
import { breadboardLaneKey } from '@/lib/circuit-networks';
import { hardwareFetch } from '@/lib/hardware-api';

const EMPTY_BOARD_POSITIONS = {};

export interface ComponentInstance {
  id: string;
  type: string;
  x: number;
  y: number;
}

export interface Wire {
  from: string;
  to: string;
  color?: string;
  net?: string;
}

interface RenderedWirePath {
  id: string;
  path: string;
  color: string;
  fromX: number;
  fromY: number;
  fromPin: string;
  labelX: number;
  labelY: number;
  labelText: string;
  fromComp: string;
  toComp: string;
  breadboardFrom?: { x: number; y: number; label: string };
  breadboardTo?: { x: number; y: number; label: string };
}

export interface TutorialStep {
  insert_after_step?: number;
  replace_step?: number;
  instruction: string;
  detail?: string;
  verify?: string;
  code?: string;
  code_language?: string;
  phase?: string;
  add_components?: any[];
  add_wiring?: any[];
  remove_components?: string[];
  remove_wiring?: Array<string | { from: string; to: string }>;
}

export interface TutorialData {
  action?: 'NEW_PROJECT' | 'UPDATE_CURRENT' | 'NEW_TAB' | 'MERGE_TAB';
  target_tab?: string;
  project_name?: string;
  description?: string;
  blueprint_svg?: string;
  steps: TutorialStep[];
}

interface CircuitCanvasProps {
  data: TutorialData | null;
  currentStep: number;
  onStepChange: (step: number) => void;
  allTabs?: any[];
  projectMemory?: string;
  sessionId?: string;
  workspaceTabId?: string;
  apiKeys?: string[];
  model?: string;
  onUpdateCircuit?: (data: any) => void;
  onCompileRequest?: (code: string) => void;
}


const getWireStats = (color: string, pin1: string, pin2: string) => {
  const isPower = color === '#ef4444' || pin1.includes('5V') || pin1.includes('3.3V') || pin1.includes('VIN');
  const isGnd = color === '#000000' || pin1.includes('GND') || pin2.includes('GND');
  const isSDA = pin1.includes('SDA') || pin2.includes('SDA');
  const isSCL = pin1.includes('SCL') || pin2.includes('SCL');
  const isPWM = color === '#f97316' || pin1.includes('~') || pin2.includes('~') || pin1.includes('PWM');
  
  if (isGnd) return { 'Voltage': '0V (Ref)', 'Current': 'Return Path', 'Type': 'Ground' };
  if (isPower) {
    const v = pin1.includes('3.3V') ? '3.3V' : (pin1.includes('9V') ? '9.0V' : '5.0V');
    return { 'Voltage': v, 'Max Current': '~500mA', 'Type': 'Power Supply' };
  }
  if (isSDA) return { 'Logic Level': '3.3V / 5V', 'Protocol': 'I2C Data', 'Frequency': '100-400 kHz' };
  if (isSCL) return { 'Logic Level': '3.3V / 5V', 'Protocol': 'I2C Clock', 'Frequency': '100-400 kHz' };
  if (isPWM) return { 'Voltage': '0-5V (Pulsed)', 'Frequency': '~490 Hz', 'Type': 'PWM Signal' };
  
  return { 'Voltage': '0-5V (Logic)', 'Max Current': '< 40mA', 'Type': 'Digital/Analog Signal' };
};

const getComponentStats = (type: string) => {
  const t = (type || '').toLowerCase();
  if (t.includes('uno') || t.includes('nano')) return { 'Operating Voltage': '5V', 'Input Voltage': '7-12V', 'Clock Speed': '16 MHz', 'Logic Level': '5V' };
  if (t.includes('esp32')) return { 'Operating Voltage': '3.3V', 'Clock Speed': '160-240 MHz', 'Wireless': 'Wi-Fi + BLE' };
  if (t.includes('motor_driver') || t.includes('l298n')) return { 'Logic Voltage': '5V', 'Motor Voltage': '5-35V', 'Max Current': '2A per channel' };
  if (t.includes('servo')) return { 'Operating Voltage': '4.8-6.0V', 'Control': 'PWM (50Hz)' };
  if (t.includes('ultrasonic') || t.includes('hc-sr04')) return { 'Operating Voltage': '5V', 'Current': '15mA', 'Frequency': '40 kHz', 'Range': '2-400cm' };
  if (t.includes('dht')) return { 'Operating Voltage': '3.3-5V', 'Current': '2.5mA max', 'Signal': 'Digital (1-wire)' };
  if (t.includes('led')) return { 'Forward Voltage': '1.8-3.3V', 'Rec. Current': '20mA' };
  if (t.includes('resistor')) return { 'Power Rating': '1/4 Watt', 'Tolerance': '±5%' };
  if (t.includes('battery')) return { 'Voltage': t.includes('9v') ? '9V' : '3.7V', 'Type': 'Power Source' };
  if (t.includes('oled') || t.includes('lcd')) return { 'Operating Voltage': '3.3-5V', 'Interface': 'I2C / SPI', 'Current': '~20mA' };
  return { 'Status': 'Passive / Generic', 'Voltage': 'Circuit Dependent' };
};

function highlightCode(code: string) {
  const escapedCode = code.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] || character);
  return escapedCode
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#737373">$1</span>')
    .replace(/(\b(int|void|const|char|bool|float|double|long|unsigned)\b)/g, '<span style="color:#bdbdbd">$1</span>')
    .replace(/(\b(if|else|for|while|return|switch|case|break|continue)\b)/g, '<span style="color:#e5e5e5">$1</span>')
    .replace(/(\b(OUTPUT|INPUT|HIGH|LOW|true|false)\b)/g, '<span style="color:#a3a3a3">$1</span>')
    .replace(/(\b(digitalWrite|digitalRead|analogWrite|analogRead|pinMode|delay|Serial|begin|print|println)\b)/g, '<span style="color:#d4d4d4">$1</span>')
    .replace(/(\b(setup|loop)\b)/g, '<span style="color:#d4d4d4">$1</span>')
    .replace(/(#include\s+(?:&lt;[^&]+&gt;|"[^"]+"))/g, '<span style="color:#a3a3a3">$1</span>')
    .replace(/("[^"]*")/g, '<span style="color:#a3a3a3">$1</span>')
    .replace(/(\b\d+\b)/g, '<span style="color:#c4c4c4">$1</span>');
}

function BreadboardGraphic({
  x,
  y,
  boardNumber,
  boardCount,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  x: number;
  y: number;
  boardNumber: number;
  boardCount: number;
  onPointerDown: (event: React.PointerEvent<SVGGElement>, boardIndex: number, x: number, y: number) => void;
  onPointerMove: (event: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (event: React.PointerEvent<SVGGElement>) => void;
}) {
  const columns = Array.from({ length: 30 }, (_, index) => index);
  const upperRows = ['A', 'B', 'C', 'D', 'E'];
  const lowerRows = ['F', 'G', 'H', 'I', 'J'];
  const renderHole = (cx: number, cy: number, key: string) => (
    <g key={key}>
      <circle cx={cx} cy={cy} r="4.4" fill="#c1c7c8" />
      <circle cx={cx} cy={cy} r="2.5" fill="#27323a" />
      <circle cx={cx - 0.7} cy={cy - 0.7} r="0.8" fill="#758087" />
    </g>
  );

  return (
    <g
      transform={`translate(${x} ${y})`}
      role="button"
      aria-label={`Move breadboard ${boardNumber}`}
      pointerEvents="all"
      style={{ cursor: 'grab' }}
      onPointerDown={event => onPointerDown(event, boardNumber - 1, x, y)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <title>Drag to move breadboard {boardNumber}</title>
      <defs>
        <linearGradient id={`breadboard-surface-${boardNumber}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5f6f1" />
          <stop offset="100%" stopColor="#d8ddd8" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="780" height="330" rx="18" fill="#000" opacity="0.22" transform="translate(0 7)" />
      <rect x="0" y="0" width="780" height="330" rx="18" fill={`url(#breadboard-surface-${boardNumber})`} stroke="#a8b0ad" strokeWidth="2" />
      <rect x="12" y="12" width="756" height="306" rx="12" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.75" />
      <text x="390" y="21" fill="#6a7377" fontSize="9" fontWeight="700" letterSpacing="2" textAnchor="middle">400-POINT BREADBOARD{boardCount > 1 ? ` · ${boardNumber}/${boardCount}` : ''}</text>

      {[39, 54, 285, 300].map((railY, railIndex) => (
        <g key={`rail-${railIndex}`}>
          <line x1="82" y1={railY} x2="721" y2={railY} stroke={railIndex % 2 === 0 ? '#d64545' : '#3779b8'} strokeWidth="1" opacity="0.65" />
          <text x="35" y={railY + 3} fill={railIndex % 2 === 0 ? '#d64545' : '#3779b8'} fontSize="10" fontWeight="700">{railIndex % 2 === 0 ? '+' : '−'}</text>
          {columns.map(column => renderHole(88 + column * 21, railY, `rail-${railIndex}-${column}`))}
        </g>
      ))}

      <rect x="20" y="70" width="740" height="94" rx="5" fill="#e8ebe7" stroke="#c2c8c5" />
      <rect x="20" y="178" width="740" height="94" rx="5" fill="#e8ebe7" stroke="#c2c8c5" />
      <rect x="20" y="164" width="740" height="14" fill="#c8ceca" />
      <line x1="20" y1="170" x2="760" y2="170" stroke="#aeb6b2" strokeWidth="1" />

      {columns.map(column => {
        const cx = 88 + column * 21;
        const number = column + 1;
        return (
          <g key={`terminal-column-${column}`}>
            <text x={cx} y="68" fill="#7a8384" fontSize="7" textAnchor="middle">{number}</text>
            <text x={cx} y="278" fill="#7a8384" fontSize="7" textAnchor="middle">{number}</text>
            <line x1={cx} y1="84" x2={cx} y2="152" stroke="#aeb8b4" strokeWidth="1" opacity="0.45" />
            <line x1={cx} y1="192" x2={cx} y2="260" stroke="#aeb8b4" strokeWidth="1" opacity="0.45" />
            {upperRows.map((row, rowIndex) => renderHole(cx, 84 + rowIndex * 17, `upper-${row}-${column}`))}
            {lowerRows.map((row, rowIndex) => renderHole(cx, 192 + rowIndex * 17, `lower-${row}-${column}`))}
          </g>
        );
      })}
      {upperRows.map((row, index) => <text key={`upper-label-${row}`} x="35" y={87 + index * 17} fill="#697477" fontSize="8" fontWeight="700" textAnchor="middle">{row}</text>)}
      {lowerRows.map((row, index) => <text key={`lower-label-${row}`} x="35" y={195 + index * 17} fill="#697477" fontSize="8" fontWeight="700" textAnchor="middle">{row}</text>)}
      <text x="390" y="319" fill="#87908e" fontSize="7" letterSpacing="1.5" textAnchor="middle">POWER RAILS · TERMINAL STRIPS · CENTER CHANNEL</text>
    </g>
  );
}

function CodePreviewModal({ code, language, onClose }: { code: string; language: string; onClose: () => void }) {
  return (
    <div data-canvas-overlay="true" onWheel={event => event.stopPropagation()} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-12">
      <div className="bg-[#090909] border border-neutral-800 w-full h-full max-w-6xl max-h-full rounded-xl shadow-2xl flex flex-col overflow-hidden" style={{ overscrollBehavior: 'contain' }}>
        <div className="h-10 bg-[#141414] border-b border-neutral-800 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[#cccccc] text-[11px] font-mono tracking-wider uppercase">{language === 'cpp' ? 'main.cpp' : 'code.ino'}</span>
          </div>
          <div className="flex items-center gap-4">
             <button onClick={() => navigator.clipboard.writeText(code)} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5" title="Copy code">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
               <span className="text-xs">Copy</span>
             </button>
             <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" title="Close">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
             </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 bg-[#090909]">
          <pre 
            className="text-[13px] leading-relaxed font-mono text-[#d4d4d4] whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: highlightCode(code) }}
          />
        </div>
      </div>
    </div>
  );
}

export function CircuitCanvas({ data, currentStep: currentStepIndex, onStepChange: setCurrentStepIndex, apiKeys, model, onUpdateCircuit, onCompileRequest, allTabs, projectMemory, sessionId, workspaceTabId }: CircuitCanvasProps) {
  const [previewCode, setPreviewCode] = useState<{ code: string; language: string; stepIndex: number } | null>(null);
  const [codeSaveStatus, setCodeSaveStatus] = useState('Preview only — save edits to update the circuit step.');
  const previewCodeLayerRef = useRef<HTMLPreElement>(null);
  const previewLineNumberRef = useRef<HTMLDivElement>(null);
  const [expandedVerifyText, setExpandedVerifyText] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wirePaths, setWirePaths] = useState<RenderedWirePath[]>([]);
  const [wokwiLoaded, setWokwiLoaded] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState(false);
  const [dockPosition, setDockPosition] = useState<'bottom-right' | 'top-left'>('bottom-right');
  const dragControls = useDragControls();
  const stepInfoDragControls = useDragControls();
  const routingPanelDragControls = useDragControls();
  const boardDragRef = useRef<{ pointerId: number; index: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const [boardPositionsByProject, setBoardPositionsByProject] = useState<Record<string, Record<number, { x: number; y: number }>>>({});
  const [boardPositionsReady, setBoardPositionsReady] = useState(false);
  const boardStorageKey = `kaktus_breadboard_positions_${sessionId || 'local'}`;
  const boardLayoutKey = `${workspaceTabId || data?.project_name || 'workspace'}:${data?.project_name || 'project'}`;
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [canvasChatOpen, setCanvasChatOpen] = useState(false);
  const [canvasChatInput, setCanvasChatInput] = useState('');
  const [canvasChatMessages, setCanvasChatMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [canvasChatLoading, setCanvasChatLoading] = useState(false);
  const [canvasChatReady, setCanvasChatReady] = useState(false);
  const canvasChatRef = useRef<HTMLDivElement>(null);

  const openCodePreview = (code: string, language: string, stepIndex = currentStepIndex) => {
    if (previewCodeLayerRef.current) previewCodeLayerRef.current.style.transform = 'translate(0px, 0px)';
    if (previewLineNumberRef.current) previewLineNumberRef.current.style.transform = 'translateY(0px)';
    setCodeSaveStatus('Preview only — save edits to update the circuit step.');
    setPreviewCode({ code, language, stepIndex });
  };

  const syncCodePreviewScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (previewCodeLayerRef.current) previewCodeLayerRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    if (previewLineNumberRef.current) previewLineNumberRef.current.style.transform = `translateY(${-scrollTop}px)`;
  };

  const savePreviewCodeToCircuit = () => {
    if (!previewCode || !data || !onUpdateCircuit) return false;
    const targetStep = data.steps[previewCode.stepIndex];
    if (!targetStep) return false;
    const detailWithoutCode = (targetStep.detail || '').replace(/```[\w+#.-]*\s*[\s\S]*?```/g, '').trim();
    onUpdateCircuit({
      ...data,
      action: 'UPDATE_CURRENT',
      target_tab: data.project_name,
      steps: [{
        ...targetStep,
        detail: detailWithoutCode || undefined,
        code: previewCode.code.trim() ? previewCode.code : undefined,
        code_language: previewCode.code.trim() ? previewCode.language : undefined,
        replace_step: previewCode.stepIndex + 1,
      }],
    });
    setCodeSaveStatus(`Saved to step ${previewCode.stepIndex + 1}.`);
    return true;
  };

  const closeCodePreview = () => {
    if ((codeSaveStatus.startsWith('Unsaved') || codeSaveStatus.startsWith('Code cleared'))
      && !window.confirm('Discard unsaved code edits? Choose Cancel to save them first.')) return;
    setPreviewCode(null);
  };

  const flashPreviewCodeInApp = () => {
    if (!previewCode?.code.trim() || !onCompileRequest || !savePreviewCodeToCircuit()) return;
    const codeToFlash = previewCode.code;
    setPreviewCode(null);
    onCompileRequest(codeToFlash);
  };
  const isArduinoCodePreview = Boolean(previewCode && /^(?:c|cpp|c\+\+|ino|arduino)$/i.test(previewCode.language));

  useEffect(() => {
    setBoardPositionsReady(false);
    try {
      const stored = localStorage.getItem(boardStorageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : {};
      setBoardPositionsByProject(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, Record<number, { x: number; y: number }>>
        : {});
    } catch {
      setBoardPositionsByProject({});
    }
    setBoardPositionsReady(true);
  }, [boardStorageKey]);

  useEffect(() => {
    if (!boardPositionsReady) return;
    try { localStorage.setItem(boardStorageKey, JSON.stringify(boardPositionsByProject)); } catch { /* Keep canvas interaction available if storage is full. */ }
  }, [boardPositionsByProject, boardPositionsReady, boardStorageKey]);

  useEffect(() => {
    setCanvasChatReady(false);
    try {
      const stored = localStorage.getItem(`kaktus_canvas_chat_${sessionId || 'local'}`);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      setCanvasChatMessages(Array.isArray(parsed)
        ? parsed.filter((message): message is { role: 'user' | 'assistant'; text: string } =>
            !!message && typeof message === 'object' &&
            ((message as { role?: unknown }).role === 'user' || (message as { role?: unknown }).role === 'assistant') &&
            typeof (message as { text?: unknown }).text === 'string'
          ).slice(-40)
        : []);
    } catch {
      setCanvasChatMessages([]);
    }
    setCanvasChatReady(true);
  }, [sessionId]);

  useEffect(() => {
    if (!canvasChatReady) return;
    try { localStorage.setItem(`kaktus_canvas_chat_${sessionId || 'local'}`, JSON.stringify(canvasChatMessages)); } catch { /* Keep canvas chat usable if storage is full. */ }
  }, [canvasChatMessages, canvasChatReady, sessionId]);

  const [isBoardConnected, setIsBoardConnected] = useState(false);

  useEffect(() => {
    const checkBoard = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await hardwareFetch('/flash/boards', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          setIsBoardConnected(Array.isArray(data.ports) && data.ports.length > 0);
          return;
        }
      } catch {
        setIsBoardConnected(false);
      }
      setIsBoardConnected(false);
    };
    checkBoard();
  }, []);

  useEffect(() => {
    canvasChatRef.current?.scrollTo({ top: canvasChatRef.current.scrollHeight, behavior: 'smooth' });
  }, [canvasChatMessages]);

  const handleCanvasChat = useCallback(async () => {
    if (!canvasChatInput.trim() || !apiKeys || apiKeys.length === 0 || !model) return;
    const userMsg = canvasChatInput.trim();
    setCanvasChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setCanvasChatInput('');
    setCanvasChatLoading(true);

    // Build context about current circuit state
    const compactedChat = compactConversationContext(canvasChatMessages);
    const promptComponents = accumulatedState.components;
    const promptWires = accumulatedState.wiring;
    const requestContents = [
      ...compactedChat.recentMessages.map(message => ({
        role: message.role === 'user' ? 'user' as const : 'model' as const,
        parts: [{ text: message.text }],
      })),
      { role: 'user' as const, parts: [{ text: userMsg }] },
    ];
        
      const systemPrompt = buildHardwareStudioSystemPrompt({
        surface: 'canvas',
        userRequest: userMsg,
        projectName: data?.project_name,
        currentStep: currentStepIndex,
        totalSteps: data?.steps?.length || 0,
        components: promptComponents,
        wires: promptWires,
        currentState: projectMemory || compactedChat.earlierContext ? {
          ...(projectMemory ? { perChatProjectMemory: projectMemory } : {}),
          ...(compactedChat.earlierContext ? { earlierConversationContext: compactedChat.earlierContext } : {}),
        } : undefined,
      });






    try {
      const isComplexHardwareBuild = /\b(?:build|create|design|construct|prototype|make)\b/i.test(userMsg)
        && /\b(?:robot|robotic|wrist|arm|motor|servo|actuator|battery|power supply|pcb|drone)\b/i.test(userMsg);
      const researchRequested = /\b(?:research|look\s*up|find\s+sources?|datasheet|manufacturer|latest|specification|rating)\b/i.test(userMsg);
      const hardwareAction = /\b(?:build|create|make|design|construct|prototype|wire|connect|add|insert|replace|change|modify)\b/i.test(userMsg);
      const groundedResearch = researchRequested || (hardwareAction
        && /\b(?:robot|robotic|wrist|joint|motor|servo|actuator|battery|mains|high[- ]current|power supply|drone|pcb)\b/i.test(userMsg));
      const agentReply = await requestAgent({
        apiKeys: apiKeys || [],
        model,
        systemPrompt: systemPrompt,
        contents: requestContents,
        temperature: 0.2,
        maxOutputTokens: isComplexHardwareBuild || groundedResearch || userMsg.length > 320 ? 16_384 : 8_192,
        research: groundedResearch,
      });
      const replyText = agentReply.text;

      // 1. Check for navigation command first
      const navMatch = /<nav\s+step="(\d+)"\s*\/>/.exec(replyText);
      if (navMatch) {
        const targetStep = parseInt(navMatch[1], 10);
        const maxStep = (data?.steps?.length || 1) - 1;
        const safeStep = Math.max(0, Math.min(targetStep, maxStep));
        setCurrentStepIndex(safeStep);
        const cleanReply = replyText.replace(/<nav\s+step="\d+"\s*\/>/g, '').replace(/<work>[\s\S]*?<\/work>/g, '').trim();
        setCanvasChatMessages(prev => [...prev, { role: 'assistant', text: cleanReply || `✅ Step ${safeStep + 1} par aa gaye!` }]);
        setCanvasChatLoading(false);
        return; // Don't process further
      }

      // 2. Apply only a complete, validated tutorial payload.
      const tutorial = extractTutorialResponse(replyText);
      if (tutorial.plan && onUpdateCircuit) {
        onUpdateCircuit(tutorial.plan);
        setCanvasChatMessages(prev => [...prev, { role: 'assistant', text: tutorial.cleanText || 'Circuit updated.' }]);
      } else {
        const cleanReply = tutorial.cleanText || cleanAgentText(replyText).trim();
        const reason = tutorial.errors.length ? ` Canvas unchanged: ${tutorial.errors.join(' ')}` : '';
        setCanvasChatMessages(prev => [...prev, { role: 'assistant', text: `${cleanReply || 'No canvas update was returned.'}${reason}` }]);
      }
    } catch (e: any) {
      const msg = e.message || '';
      // Auto-retry once on transient errors (service unavailable, rate limit, network)
      if (msg.includes('unavailable') || msg.includes('503') || msg.includes('429') || msg.includes('network')) {
        setCanvasChatMessages(prev => [...prev, { role: 'assistant', text: '⏳ Service busy, retrying in 2s...' }]);
        await new Promise(r => setTimeout(r, 2000));
        try {
          const retryReply = await requestAgent({
            apiKeys: apiKeys || [], model,
            systemPrompt: systemPrompt,
            contents: requestContents,
            maxOutputTokens: 32768,
          });
          const cleanReply = cleanAgentText(retryReply.text).trim();
          // Remove the "retrying..." message and add the real reply
          setCanvasChatMessages(prev => [...prev.slice(0, -1), { role: 'assistant', text: cleanReply || '✅ Done!' }]);
          setCanvasChatLoading(false);
          return;
        } catch {
          // Retry also failed
        }
      }
      setCanvasChatMessages(prev => [...prev, { role: 'assistant', text: `Error: ${msg}. Please try again.` }]);
    }
    setCanvasChatLoading(false);
  }, [canvasChatInput, apiKeys, model, data, currentStepIndex, allTabs, canvasChatMessages, onUpdateCircuit, projectMemory]);

  useEffect(() => {
    import('@wokwi/elements').then(() => {
      setWokwiLoaded(true);
    }).catch(error => {
      console.error('Wokwi elements unavailable; using canvas SVG fallbacks.', error);
      setWokwiLoaded(true);
    });
  }, []);

  // Compute accumulated state up to current step
  const accumulatedState = useMemo(() => {
    if (!data) return { components: [], wiring: [], instruction: '' };
    
    const compMap = new Map<string, any>();
    
    // Pre-populate with components from all OTHER tabs so cross-tab wiring works
    if (allTabs) {
      allTabs.forEach(tab => {
        if (tab.name !== data?.project_name && tab.components) {
          tab.components.forEach((c: any) => {
            // Add with a subtle ghost flag so we know it's external
            compMap.set(c.id, { ...c, isExternal: true });
          });
        }
      });
    }
    const wireMap = new Map<string, any>();
    let instruction = '';

    for (let i = 0; i <= currentStepIndex && i < data.steps.length; i++) {
      const step = data.steps[i];
      
      // Handle removals first
      if (step.remove_components) {
        step.remove_components.forEach(id => {
          compMap.delete(id);
          // Also remove any wiring connected to this component
          for (const [key, w] of Array.from(wireMap.entries())) {
            if (w.from.startsWith(id + ':') || w.to.startsWith(id + ':')) {
              wireMap.delete(key);
            }
          }
        });
      }
      
      if (step.remove_wiring) {
        step.remove_wiring.forEach(item => {
          if (typeof item === 'string') {
            for (const [key, w] of Array.from(wireMap.entries())) {
              if (w.from === item || w.to === item) wireMap.delete(key);
            }
          } else if (item && typeof item === 'object' && item.from && item.to) {
            wireMap.delete(`${item.from}-${item.to}`);
          }
        });
      }

      if (step.add_components) {
        step.add_components.forEach(c => compMap.set(c.id, c));
      }
      if (step.add_wiring) {
        step.add_wiring.forEach(w => wireMap.set(`${w.from}-${w.to}`, w));
      }
      if (i === currentStepIndex) {
        instruction = step.instruction;
      }
    }

    return {
      components: Array.from(compMap.values()),
      wiring: Array.from(wireMap.values()),
      instruction
    };
  }, [data, currentStepIndex, allTabs]);

  const selectedComponentConnections = useMemo(() => {
    if (!selectedComponentId) return [];

    return accumulatedState.wiring.flatMap((wire: any, index) => {
      const [fromComp = '', fromPin = ''] = String(wire.from || '').split(':', 2);
      const [toComp = '', toPin = ''] = String(wire.to || '').split(':', 2);
      const isSource = fromComp === selectedComponentId;
      const isTarget = toComp === selectedComponentId;
      if (!isSource && !isTarget) return [];

      return [{
        id: wire.id || `${wire.from}->${wire.to}-${index}`,
        myPin: isSource ? fromPin : toPin,
        otherComp: isSource ? toComp : fromComp,
        otherPin: isSource ? toPin : fromPin,
      }];
    });
  }, [accumulatedState.wiring, selectedComponentId]);

  const breadboardPlan = useMemo(() => {
    const components = new Map<string, any>();
    const wires = new Map<string, any>();
    const wireSlots = new Map<string, number>();
    const key = (from: string, to: string) => [from.toLowerCase(), to.toLowerCase()].sort().join('|');
    let maxConcurrentWires = 0;
    let boardNeededDuringPlan = false;
    allTabs?.forEach(tab => {
      if (tab.name !== data?.project_name) tab.components?.forEach((component: any) => components.set(component.id, component));
    });
    for (const step of data?.steps || []) {
      for (const id of step.remove_components || []) {
        components.delete(id);
        for (const [wireKey, wire] of wires) {
          if (wire.from.startsWith(`${id}:`) || wire.to.startsWith(`${id}:`)) wires.delete(wireKey);
        }
      }
      for (const removal of step.remove_wiring || []) {
        for (const [wireKey, wire] of wires) {
          const remove = typeof removal === 'string'
            ? wire.from === removal || wire.to === removal
            : key(wire.from, wire.to) === key(removal.from, removal.to);
          if (remove) wires.delete(wireKey);
        }
      }
      for (const component of step.add_components || []) components.set(component.id, component);
      for (const wire of step.add_wiring || []) {
        const wireKey = key(wire.from, wire.to);
        const laneKey = breadboardLaneKey(wire, id => components.get(id)?.type);
        if (!wireSlots.has(laneKey)) wireSlots.set(laneKey, wireSlots.size);
        wires.set(wireKey, wire);
      }
      maxConcurrentWires = Math.max(maxConcurrentWires, wires.size);
      const activeLaneCount = new Set(Array.from(wires.values(), wire => breadboardLaneKey(wire, id => components.get(id)?.type))).size;
      if (wires.size >= 6 || activeLaneCount < wires.size || Array.from(components.values()).some(component => /breadboard/i.test(component.type || ''))) {
        boardNeededDuringPlan = true;
      }
    }
    const required = boardNeededDuringPlan;
    return { required, boardCount: required ? Math.max(1, Math.ceil(wireSlots.size / 60)) : 0, wireSlots };
  }, [data, allTabs]);

  const breadboardPosition = useMemo(() => {
    if (!breadboardPlan.required) return null;
    const plannedComponentMap = new Map<string, ComponentInstance>();
    for (const step of data?.steps || []) {
      for (const id of step.remove_components || []) plannedComponentMap.delete(id);
      for (const component of step.add_components || []) plannedComponentMap.set(component.id, component);
    }
    const positionedComponents = Array.from(plannedComponentMap.values());
    if (!positionedComponents.length) return { x: 900, y: 500, boardCount: breadboardPlan.boardCount };
    const centerX = positionedComponents.reduce((total, component) => total + (Number(component.x) || 0), 0) / positionedComponents.length;
    const centerY = positionedComponents.reduce((total, component) => total + (Number(component.y) || 0), 0) / positionedComponents.length;
    const totalWidth = breadboardPlan.boardCount * 780 + (breadboardPlan.boardCount - 1) * 30;
    return { x: centerX - totalWidth / 2, y: centerY - 165, boardCount: breadboardPlan.boardCount };
  }, [accumulatedState.components, breadboardPlan, data]);

  const activeBoardPositions = boardPositionsByProject[boardLayoutKey] || EMPTY_BOARD_POSITIONS;
  const getBreadboardPosition = useCallback((boardIndex: number) => {
    if (!breadboardPosition) return null;
    return activeBoardPositions[boardIndex] || {
      x: breadboardPosition.x + boardIndex * 810,
      y: breadboardPosition.y,
    };
  }, [activeBoardPositions, breadboardPosition]);

  // Helper to find a pin robustly
  const findPin = (pinInfo: any[], pinName: string) => {
    if (!pinInfo) return null;
    const nameUpper = pinName.toUpperCase();
    
    // Exact match
    let pin = pinInfo.find(p => p.name.toUpperCase() === nameUpper);
    if (pin) return pin;

    // Alias mapping for ESP32 and common conventions
    const aliases: Record<string, string[]> = {
      '5V': ['VIN', 'VCC', '5V.1', '5V.2'],
      '3V3': ['3.3V', '3V', '3V3.1'],
      'GND': ['GND.1', 'GND.2', 'GND.3']
    };

    if (aliases[nameUpper]) {
      for (const alias of aliases[nameUpper]) {
        pin = pinInfo.find(p => p.name.toUpperCase() === alias);
        if (pin) return pin;
      }
    }
    
    // Partial match as last resort (e.g. GND matches GND.1)
    return pinInfo.find(p => p.name.toUpperCase().includes(nameUpper));
  };

  const updateWires = () => {
    if (!containerRef.current) return;
    const paths: typeof wirePaths = [];

    const getPinOffset = (el: any, compType: string, pinName: string, rect: {width: number, height: number}) => {
      let pin = findPin(el.pinInfo || [], pinName);
      let scaleX = 1;
      let scaleY = 1;
      let offsetX = 0;
      let offsetY = 0;
      
      if (!pin) {
        const hardcoded: Record<string, any> = {
          'esp32': { viewBox: { w: 107, h: 201 }, pins: { 'VIN': { x: 5, y: 158.5 }, '3V3': { x: 101.3, y: 158.5 }, 'GND.1': { x: 101.3, y: 149 }, 'GND.2': { x: 5, y: 149 } } },
          'led': { viewBox: { w: 40, h: 50 }, pins: { 'A': { x: 25, y: 42 }, 'C': { x: 15, y: 42 } } }
        };
        const fallbackComp = hardcoded[compType];
        if (fallbackComp) {
           pin = findPin(Object.keys(fallbackComp.pins).map(k => ({ name: k, ...fallbackComp.pins[k] })), pinName);
           if (pin) { scaleX = rect.width / fallbackComp.viewBox.w; scaleY = rect.height / fallbackComp.viewBox.h; }
        }
      } else {
         if (el.shadowRoot) {
           const svg = el.shadowRoot.querySelector('svg');
           if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
             scaleX = rect.width / svg.viewBox.baseVal.width;
             scaleY = rect.height / svg.viewBox.baseVal.height;
             offsetX = svg.viewBox.baseVal.x;
             offsetY = svg.viewBox.baseVal.y;
           }
         }
      }
      
      if (!pin) {
        const pUpper = pinName.toUpperCase();
        if (compType.includes('motor') || compType.includes('dc_motor')) {
            const isPos = pUpper.includes('+') || pUpper.includes('POS') || pUpper === '1';
            return { x: 18 * (rect.width/100), y: (isPos ? 20 : 60) * (rect.height/80) };
        }
        if (compType.includes('battery') || compType.includes('9v')) {
            const isPos = pUpper.includes('+') || pUpper.includes('VCC') || pUpper.includes('POS');
            return { x: (isPos ? 27 : 43) * (rect.width/70), y: 10 * (rect.height/100) };
        }
        if (compType.includes('l298n') || compType.includes('driver')) {
            const isOut = pUpper.includes('OUT');
            const idx = (parseInt(pUpper.replace(/[^0-9]/g, '')) || 1) - 1;
            const px = isOut ? (17 + (idx%4)*20) : (18 + (idx%6)*22);
            return { x: px * (rect.width/160), y: (isOut ? 7 : 105) * (rect.height/120) };
        }
        if (compType.includes('ir_sensor') || compType.includes('ir_line')) {
            let px = 41;
            if (pUpper.includes('VCC') || pUpper.includes('5V')) px = 21;
            if (pUpper.includes('OUT') || pUpper.includes('SIG')) px = 61;
            return { x: px * (rect.width/80), y: 44 * (rect.height/50) };
        }
        
        if (compType.includes('lm386') || compType.includes('lm') || compType.includes('op_amp') || compType.includes('ic_')) {
            let pinNum = parseInt(pUpper.replace(/[^0-9]/g, ''));
            if (pUpper === 'VCC') pinNum = 6;
            if (pUpper === 'GND') pinNum = 4;
            if (pUpper === 'IN' || pUpper === 'IN1') pinNum = 2;
            if (pUpper === 'IN2') pinNum = 3;
            if (pUpper === 'OUT') pinNum = 5;
            
            if (pinNum >= 1 && pinNum <= 8) {
                const isLeft = pinNum <= 4;
                const idx = isLeft ? (pinNum - 1) : (8 - pinNum);
                return { 
                    x: (isLeft ? 11 : 89) * (rect.width/100), 
                    y: (18 + idx * 12) * (rect.height/80) 
                };
            }
        }
        
        let hash = 0;
        for (let i = 0; i < pUpper.length; i++) hash += pUpper.charCodeAt(i);
        if (pUpper === 'GND' || pUpper === 'VCC' || pUpper === '5V') hash = (hash % 6) + 6; 
        
        const slot = hash % 12;
        const isTop = slot < 6;
        const index = slot % 6;
        const px = 21 + index * 20;
        const py = isTop ? 7 : 83;
        
        return { x: px * (rect.width/140), y: py * (rect.height/90) };
      }
      
      return { x: (pin.x - offsetX) * scaleX, y: (pin.y - offsetY) * scaleY };
    };

    accumulatedState.wiring.forEach((wire, idx) => {
      const [fromId, fromPin] = wire.from.split(':');
      const [toId, toPin] = wire.to.split(':');
      const wireSlotIndex = breadboardPlan.wireSlots.get(breadboardLaneKey(wire, id => accumulatedState.components.find(component => component.id === id)?.type)) ?? idx;

      const fromEl = document.getElementById(`comp-${fromId}`);
      const toEl = document.getElementById(`comp-${toId}`);
      const fromCompData = accumulatedState.components.find(c => c.id === fromId);
      const toCompData = accumulatedState.components.find(c => c.id === toId);

      if (fromEl && toEl && fromCompData && toCompData) {
        const fromRect = { width: fromEl.offsetWidth, height: fromEl.offsetHeight };
        const toRect = { width: toEl.offsetWidth, height: toEl.offsetHeight };

        const fromCoords = getPinOffset(fromEl, fromCompData.type, fromPin, fromRect);
        const toCoords = getPinOffset(toEl, toCompData.type, toPin, toRect);

        // Read real-time translation from Framer Motion's transform
        const getRealPos = (el: HTMLElement, baseComp: any) => {
          let tx = 0, ty = 0;
          const style = window.getComputedStyle(el);
          const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
          tx = matrix.m41;
          ty = matrix.m42;
          return { x: baseComp.x + tx, y: baseComp.y + ty, rotate: baseComp.rotate || 0 };
        };

        const realFrom = getRealPos(fromEl, fromCompData);
        const realTo = getRealPos(toEl, toCompData);

        // Calculate absolute point considering rotation around center
        const getRotatedPoint = (rect: {width: number, height: number}, coords: {x: number, y: number}, realPos: {x: number, y: number, rotate: number}) => {
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const dx = coords.x - cx;
            const dy = coords.y - cy;
            const angle = (realPos.rotate * Math.PI) / 180;
            const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
            const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
            return {
                x: realPos.x + cx + rx,
                y: realPos.y + cy + ry
            };
        };

        const fromPt = getRotatedPoint(fromRect, fromCoords, realFrom);
        const toPt = getRotatedPoint(toRect, toCoords, realTo);

        const x1 = fromPt.x;
        const y1 = fromPt.y;
        const x2 = toPt.x;
        const y2 = toPt.y;

        const makeSegment = (start: { x: number; y: number }, end: { x: number; y: number }, segmentIndex: number) => {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const tension = Math.min(dist * 0.4, 120);

          if (Math.abs(dy) < 50) {
            const sag = 15 + (segmentIndex % 3) * 8;
            const midX = (start.x + end.x) / 2;
            return `M ${start.x} ${start.y} C ${midX} ${start.y + sag}, ${midX} ${end.y + sag}, ${end.x} ${end.y}`;
          }
          if (Math.abs(dx) < 50) {
            const sway = 15 + (segmentIndex % 3) * 8;
            const midY = (start.y + end.y) / 2;
            return `M ${start.x} ${start.y} C ${start.x + sway} ${midY}, ${end.x + sway} ${midY}, ${end.x} ${end.y}`;
          }

          const cx1 = start.x + dx * 0.25;
          const cy1 = start.y + dy * 0.05;
          const cx2 = end.x - dx * 0.25;
          const cy2 = end.y - dy * 0.05;
          return `M ${start.x} ${start.y} C ${cx1} ${cy1 + tension * 0.3}, ${cx2} ${cy2 - tension * 0.3}, ${end.x} ${end.y}`;
        };

        let path = makeSegment({ x: x1, y: y1 }, { x: x2, y: y2 }, idx);
        let breadboardFrom: RenderedWirePath['breadboardFrom'];
        let breadboardTo: RenderedWirePath['breadboardTo'];
        if (breadboardPosition) {
          const slot = wireSlotIndex % 60;
          const boardIndex = Math.floor(wireSlotIndex / 60);
          const column = slot % 30;
          const lowerStrip = slot >= 30;
          const boardPosition = getBreadboardPosition(boardIndex);
          if (!boardPosition) return;
          const boardX = boardPosition.x + 88 + column * 21;
          const firstRow = lowerStrip ? 'F' : 'A';
          const lastRow = lowerStrip ? 'J' : 'E';
          const firstY = boardPosition.y + (lowerStrip ? 192 : 84);
          breadboardFrom = { x: boardX, y: firstY, label: `${firstRow}${column + 1}` };
          breadboardTo = { x: boardX, y: firstY + 68, label: `${lastRow}${column + 1}` };
          path = `${makeSegment({ x: x1, y: y1 }, breadboardFrom, idx)} ${makeSegment(breadboardTo, { x: x2, y: y2 }, idx + 1)}`;
        }

        const wireId = (wire.id && !paths.some(p => p.id === wire.id))
          ? wire.id
          : `wire-${wireSlotIndex}-${fromId}:${fromPin}-${toId}:${toPin}-${idx}`;

        paths.push({
          id: wireId,
          path,
          color: wire.color || '#888',
          fromX: x1, fromY: y1, fromPin: fromPin,
          labelX: x2, labelY: y2, labelText: toPin,
          fromComp: fromId,
          toComp: toId,
          breadboardFrom,
          breadboardTo,
        });
      }
    });
    setWirePaths(paths);
  };

  // RAF-throttled drag handler for smooth real-time wire updates
  const dragRAF = useRef<number>(0);
  const handleDrag = () => {
    if (dragRAF.current) cancelAnimationFrame(dragRAF.current);
    dragRAF.current = requestAnimationFrame(() => {
      updateWires();
    });
  };

  const handleDragEnd = () => {
    // Final wire update after drag completes
    setTimeout(() => updateWires(), 0);
    setTimeout(() => updateWires(), 50);
  };

  // Wire update on state changes + periodic sync during component animations
  const boardPositionsFingerprint = useMemo(() => {
    return JSON.stringify(activeBoardPositions);
  }, [activeBoardPositions]);

  useEffect(() => {
    updateWires();
    const t1 = setTimeout(() => updateWires(), 150);
    const t2 = setTimeout(() => updateWires(), 400);
    const t3 = setTimeout(() => updateWires(), 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [accumulatedState.components, accumulatedState.wiring, boardPositionsFingerprint, breadboardPosition?.x, breadboardPosition?.y, breadboardPosition?.boardCount, boardLayoutKey, wokwiLoaded, currentStepIndex]);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const startPanRef = useRef({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  const boardDragRAF = useRef<number>(0);

  const handleBreadboardPointerDown = (event: React.PointerEvent<SVGGElement>, boardIndex: number, x: number, y: number) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    boardDragRef.current = {
      pointerId: event.pointerId,
      index: boardIndex,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: x,
      startY: y,
    };
  };

  const handleBreadboardPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = boardDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientX = event.clientX;
    const clientY = event.clientY;

    if (boardDragRAF.current) cancelAnimationFrame(boardDragRAF.current);
    boardDragRAF.current = requestAnimationFrame(() => {
      const scale = Math.max(0.1, transform.scale);
      const newX = drag.startX + (clientX - drag.startClientX) / scale;
      const newY = drag.startY + (clientY - drag.startClientY) / scale;

      setBoardPositionsByProject(previous => {
        const currentProject = previous[boardLayoutKey];
        const currentPos = currentProject?.[drag.index];
        if (currentPos && Math.abs(currentPos.x - newX) < 0.5 && Math.abs(currentPos.y - newY) < 0.5) {
          return previous;
        }
        return {
          ...previous,
          [boardLayoutKey]: {
            ...(currentProject || {}),
            [drag.index]: {
              x: newX,
              y: newY,
            },
          },
        };
      });
      handleDrag();
    });
  };

  const handleBreadboardPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (boardDragRef.current?.pointerId === event.pointerId) {
      boardDragRef.current = null;
      if (boardDragRAF.current) cancelAnimationFrame(boardDragRAF.current);
      handleDragEnd();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).id === 'workspace-bg' || (e.target as HTMLElement).tagName === 'svg') {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (isPanning) {
      setTransform(prev => ({ ...prev, x: e.clientX - startPanRef.current.x, y: e.clientY - startPanRef.current.y }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const handleNativeWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Check if cursor is over any floating card, drawer, overlay, or code editor
      const isOverlayElement = Boolean(
        target.closest('[data-canvas-overlay]') ||
        target.closest('textarea, pre, code, [role="dialog"]') ||
        (target.closest('.overflow-y-auto, .overflow-auto, .overflow-x-auto') && !target.closest('#workspace-bg'))
      );

      // If user is scrolling over a card or code editor, let it scroll naturally and do NOT zoom the canvas
      if (isOverlayElement && target.id !== 'workspace-bg' && !target.closest('#workspace-bg')) {
        return;
      }

      // User is scrolling on the canvas panel / background / circuit - zoom canvas smoothly
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Responsive zoom calculation
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;

      setTransform(prev => {
        const newScale = Math.min(Math.max(0.15, prev.scale * zoomFactor), 4.5);
        // Anchor zoom around cursor position for intuitive Figma/IDE feel:
        const scaleRatio = newScale / prev.scale;
        const newX = mouseX - (mouseX - prev.x) * scaleRatio;
        const newY = mouseY - (mouseY - prev.y) * scaleRatio;

        return {
          x: newX,
          y: newY,
          scale: newScale,
        };
      });
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, []);

  return (
    <div id="circuit-canvas-container" ref={containerRef} className="relative w-full h-full bg-[#1e1e1e] rounded-xl overflow-hidden border border-gray-800 shadow-2xl flex flex-col select-none">
      <style>{`
        @keyframes dashHologram {
          to { stroke-dashoffset: -1000; }
        }
        .blueprint-hologram path, 
        .blueprint-hologram circle, 
        .blueprint-hologram rect {
          animation: dashHologram 30s linear infinite;
        }
        
        @keyframes wireFlow {
          to { stroke-dashoffset: -28; }
        }
        .wire-flow {
          animation: wireFlow 1s linear infinite;
        }
      `}</style>

      <div 
        id="workspace-bg"
        className="absolute inset-0 pointer-events-auto touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}

        onClick={() => { setSelectedComponentId(null); setSelectedWireId(null); }}
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
          backgroundSize: `${20 * transform.scale}px ${20 * transform.scale}px`,
          backgroundPosition: `${transform.x}px ${transform.y}px`,
          cursor: isPanning ? 'grabbing' : 'grab'
        }} 
      />

      {/* Mouse Hover Glow Effect */}
      <div 
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255,255,255,0.04), transparent 40%)`
        }}
      />

      {/* Workspace Area - Zoomable/Pannable */}
      <div className="absolute inset-0 pointer-events-none">
        <div 
          className="absolute origin-top-left pointer-events-none"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, width: '4000px', height: '4000px' }}
        >
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
            style={{ overflow: 'visible' }}
            onPointerMove={handleBreadboardPointerMove}
            onPointerUp={handleBreadboardPointerUp}
            onPointerCancel={handleBreadboardPointerUp}
          >
            {breadboardPosition && Array.from({ length: breadboardPosition.boardCount }, (_, index) => (
              (() => {
                const position = getBreadboardPosition(index);
                if (!position) return null;
                return <BreadboardGraphic
                  key={`breadboard-${index}`}
                  x={position.x}
                  y={position.y}
                  boardNumber={index + 1}
                  boardCount={breadboardPosition.boardCount}
                  onPointerDown={handleBreadboardPointerDown}
                  onPointerMove={() => undefined}
                  onPointerUp={() => undefined}
                />;
              })()
            ))}

            {/* Blueprint Hologram Layer (Behind components and wires) */}
            {data?.blueprint_svg && (
              <g 
                className="blueprint-hologram"
                dangerouslySetInnerHTML={{ __html: data.blueprint_svg }} 
                style={{ opacity: 0.8 }}
              />
            )}
            
            <AnimatePresence>
              {wirePaths.map(wire => {
                const isSelected = selectedComponentId === wire.fromComp || selectedComponentId === wire.toComp || selectedWireId === wire.id;
                const isDimmed = (selectedComponentId !== null || selectedWireId !== null) && !isSelected;
                return (
              <motion.g 
                key={wire.id} 
                initial={{ opacity: 0 }} 
                animate={{ opacity: isDimmed ? 0.05 : 1 }} 
                exit={{ opacity: 0 }}
                style={{ transition: 'opacity 0.2s' }}
              >
                {/* Clickable invisible hit area */}
                <path
                  d={wire.path}
                  stroke="transparent"
                  strokeWidth={20}
                  fill="none"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setSelectedWireId(wire.id); setSelectedComponentId(null); }}
                />
                {/* Wire trace background */}
                <path
                  d={wire.path}
                  stroke={wire.color}
                  strokeWidth={2}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.5}
                />
                {/* Flowing current dash */}
                <path
                  d={wire.path}
                  stroke={wire.color}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray="6 8"
                  className="wire-flow"
                />

                {wire.breadboardFrom && wire.breadboardTo && (
                  <g>
                    <line x1={wire.breadboardFrom.x} y1={wire.breadboardFrom.y} x2={wire.breadboardTo.x} y2={wire.breadboardTo.y} stroke={wire.color} strokeWidth={selectedWireId === wire.id ? 3 : 1.5} opacity={selectedWireId === wire.id ? 0.9 : 0.55} />
                    {[wire.breadboardFrom, wire.breadboardTo].map(hole => (
                      <g key={hole.label}>
                        <circle cx={hole.x} cy={hole.y} r={selectedWireId === wire.id ? 6 : 4.5} fill={wire.color} stroke="#17202a" strokeWidth="1.5" />
                        {selectedWireId === wire.id && (
                          <text x={hole.x + 7} y={hole.y - 6} fill={wire.color} fontSize="8" fontFamily="monospace" fontWeight="bold" paintOrder="stroke" stroke="#f5f6f1" strokeWidth="2">
                            {hole.label}
                          </text>
                        )}
                      </g>
                    ))}
                  </g>
                )}
                
                {/* Source pin: glow + dot + label */}
                <circle cx={wire.fromX} cy={wire.fromY} r="6" fill={wire.color} opacity="0.15" />
                <circle cx={wire.fromX} cy={wire.fromY} r="4" fill={wire.color} stroke="#0a0a0a" strokeWidth="1.5" />
                <text x={wire.fromX + 7} y={wire.fromY - 6} fill={wire.color} fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.9">
                  {wire.fromPin}
                </text>
                
                {/* Target pin: glow + dot + label */}
                <circle cx={wire.labelX} cy={wire.labelY} r="6" fill={wire.color} opacity="0.15" />
                <circle cx={wire.labelX} cy={wire.labelY} r="4" fill={wire.color} stroke="#0a0a0a" strokeWidth="1.5" />
                <text x={wire.labelX + 7} y={wire.labelY - 6} fill={wire.color} fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.9">
                  {wire.labelText}
                </text>
              </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        <AnimatePresence>
          {wokwiLoaded && accumulatedState.components.map(comp => {
            // Full mapping of user-friendly names -> wokwi element tags
            const wokwiMap: Record<string, string> = {
              'esp32': 'wokwi-esp32-devkit-v1',
              'arduino_uno': 'wokwi-arduino-uno',
              'arduino': 'wokwi-arduino-uno',
              'arduino_mega': 'wokwi-arduino-mega',
              'arduino_nano': 'wokwi-arduino-nano',
              'led': 'wokwi-led',
              'rgb_led': 'wokwi-rgb-led',
              'led_ring': 'wokwi-led-ring',
              'led_bar': 'wokwi-led-bar-graph',
              'neopixel': 'wokwi-neopixel',
              'neopixel_matrix': 'wokwi-neopixel-matrix',
              'resistor': 'wokwi-resistor',
              'potentiometer': 'wokwi-potentiometer',
              'slide_potentiometer': 'wokwi-slide-potentiometer',
              'dht22': 'wokwi-dht22',
              'hc-sr04': 'wokwi-hc-sr04',
              'hcsr04': 'wokwi-hc-sr04',
              'ultrasonic': 'wokwi-hc-sr04',
              'pir': 'wokwi-pir-motion-sensor',
              'pir_sensor': 'wokwi-pir-motion-sensor',
              'ntc': 'wokwi-ntc-temperature-sensor',
              'photoresistor': 'wokwi-photoresistor-sensor',
              'ldr': 'wokwi-photoresistor-sensor',
              'gas_sensor': 'wokwi-gas-sensor',
              'mq2': 'wokwi-gas-sensor',
              'flame_sensor': 'wokwi-flame-sensor',
              'heart_sensor': 'wokwi-heart-beat-sensor',
              'sound_sensor': 'wokwi-big-sound-sensor',
              'ir_receiver': 'wokwi-ir-receiver',
              'ir_remote': 'wokwi-ir-remote',
              'servo': 'wokwi-servo',
              'stepper': 'wokwi-stepper-motor',
              'stepper_motor': 'wokwi-stepper-motor',
              'buzzer': 'wokwi-buzzer',
              'pushbutton': 'wokwi-pushbutton',
              'button': 'wokwi-pushbutton',
              'slide_switch': 'wokwi-slide-switch',
              'dip_switch': 'wokwi-dip-switch-8',
              'keypad': 'wokwi-membrane-keypad',
              'rotary_encoder': 'wokwi-ky-040',
              'lcd': 'wokwi-lcd1602',
              'lcd1602': 'wokwi-lcd1602',
              'lcd2004': 'wokwi-lcd2004',
              'oled': 'wokwi-ssd1306',
              'ssd1306': 'wokwi-ssd1306',
              'tft': 'wokwi-ili9341',
              'ili9341': 'wokwi-ili9341',
              '7segment': 'wokwi-7segment',
              'rtc': 'wokwi-ds1307',
              'ds1307': 'wokwi-ds1307',
              'mpu6050': 'wokwi-mpu6050',
              'accelerometer': 'wokwi-mpu6050',
              'hx711': 'wokwi-hx711',
              'load_cell': 'wokwi-hx711',
              'sd_card': 'wokwi-microsd-card',
              'relay': 'wokwi-ks2e-m-dc5',
              'joystick': 'wokwi-analog-joystick',
              'tilt_switch': 'wokwi-tilt-switch',
            };

            const rawIdentity = [comp.type, comp.id, comp.label, comp.value, comp.custom?.description]
              .filter(Boolean).join(' ').toLowerCase();
            let renderType = String(comp.type || 'custom').toLowerCase();
            if (renderType === 'custom' || renderType.startsWith('custom_')) {
              if (/arduino.{0,20}(uno|r3)|\buno\b/.test(rawIdentity)) renderType = 'arduino_uno';
              else if (/\besp32\b/.test(rawIdentity)) renderType = 'esp32';
              else if (/l298n?|motor driver|h-bridge/.test(rawIdentity)) renderType = 'l298n';
              else if (/(ir|infrared|tcrt5000).{0,28}(sensor|reflective|line)|ir_sensor/.test(rawIdentity)) renderType = 'ir_sensor';
              else if (/(dc|gear|drive).{0,16}motor|motor_(left|right)/.test(rawIdentity)) renderType = 'dc_motor';
              else if (/battery|aa pack/.test(rawIdentity)) renderType = 'battery';
              else if (/chassis|frame/.test(rawIdentity)) renderType = 'chassis';
              else if (/servo/.test(rawIdentity)) renderType = 'servo';
            }
            const wokwiTag = wokwiMap[renderType];
            const useWokwiElement = Boolean(wokwiTag && typeof customElements !== 'undefined' && customElements.get(wokwiTag));
            const scaleVal = renderType === 'led' ? 2 : (renderType === 'esp32' || renderType === 'arduino_uno' || renderType === 'arduino') ? 1.3 : 1;

            const isCompDimmed = selectedComponentId !== null && selectedComponentId !== comp.id;

            return (
              <motion.div
                key={comp.id}
                id={`comp-${comp.id}`}
                drag
                dragMomentum={false}
                dragElastic={0}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedComponentId(comp.id === selectedComponentId ? null : comp.id);
                }}
                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                animate={{ opacity: isCompDimmed ? 0.3 : 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ type: 'spring', bounce: 0.3 }}
                className="absolute z-20 cursor-move pointer-events-auto"
                style={{ 
                  left: comp.x, 
                  top: comp.y, 
                  transformOrigin: 'center center',
                  scale: scaleVal,
                  zIndex: selectedComponentId === comp.id ? 30 : 20,
                }}
              >
                {useWokwiElement ? (
                  (() => {
                    const Tag = wokwiTag as any;
                    if (renderType === 'led') return <Tag color="red" />;
                    if (renderType === 'rgb_led') return <Tag />;
                    if (renderType === 'resistor') return <Tag value="220" />;
                    return <Tag />;
                  })()
                ) : (
                  /* Unique SVG per component type */
                  (() => {
                    const t = renderType;
                    
                    // PCA9685 Servo Driver
                    if (t.includes('pca9685') || t.includes('driver_board')) return (
                      <svg width="120" height="70" viewBox="0 0 120 70">
                        <rect x="5" y="5" width="110" height="60" rx="4" fill="#0d47a1" stroke="#1565c0" strokeWidth="2"/>
                        <rect x="30" y="15" width="60" height="40" rx="2" fill="#1a1a1a" stroke="#333" strokeWidth="1"/>
                        <text x="60" y="38" fill="white" fontSize="10" textAnchor="middle" fontWeight="bold">PCA9685</text>
                        {/* 16 servo headers (PWM, VCC, GND) */}
                        {[...Array(8)].map((_,i) => <g key={`t${i}`}><rect x={35+i*7} y="6" width="3" height="3" fill="yellow"/><rect x={35+i*7} y="10" width="3" height="3" fill="red"/><rect x={35+i*7} y="14" width="3" height="3" fill="black"/></g>)}
                        {[...Array(8)].map((_,i) => <g key={`b${i}`}><rect x={35+i*7} y="52" width="3" height="3" fill="black"/><rect x={35+i*7} y="56" width="3" height="3" fill="red"/><rect x={35+i*7} y="60" width="3" height="3" fill="yellow"/></g>)}
                        <text x="60" y="65" fill="#90caf9" fontSize="6" textAnchor="middle">{comp.id}</text>
                        {/* Power/I2C Pins */}
                        <circle cx="15" cy="20" r="3" fill="#e74c3c"/><text x="15" y="15" fill="white" fontSize="5" textAnchor="middle">V+</text>
                        <circle cx="15" cy="50" r="3" fill="#333" stroke="white" strokeWidth="0.5"/><text x="15" y="60" fill="white" fontSize="5" textAnchor="middle">GND</text>
                        <circle cx="105" cy="25" r="2" fill="#f1c40f"/><text x="112" y="27" fill="white" fontSize="5">SDA</text>
                        <circle cx="105" cy="35" r="2" fill="#f1c40f"/><text x="112" y="37" fill="white" fontSize="5">SCL</text>
                      </svg>
                    );

                    // Servo Motors (SG90 / MG996R)
                    if (t.includes('servo') || t.includes('sg90') || t.includes('mg996r')) return (
                      <svg width="80" height="70" viewBox="0 0 80 70">
                        <rect x="20" y="15" width="40" height="40" rx="3" fill={t.includes('mg996') ? "#111" : "#0288d1"} stroke="#01579b" strokeWidth="1.5"/>
                        <rect x="15" y="25" width="50" height="10" fill={t.includes('mg996') ? "#222" : "#03a9f4"}/>
                        <circle cx="40" cy="20" r="12" fill="#fff" stroke="#ccc" strokeWidth="2"/>
                        <circle cx="40" cy="20" r="4" fill="#333"/>
                        <line x1="40" y1="20" x2="40" y2="8" stroke="#333" strokeWidth="2"/>
                        {/* Wires */}
                        <path d="M 60 45 Q 70 45 70 55" fill="none" stroke="#e74c3c" strokeWidth="2"/>
                        <path d="M 60 48 Q 72 48 72 55" fill="none" stroke="#333" strokeWidth="2"/>
                        <path d="M 60 51 Q 74 51 74 55" fill="none" stroke="#f39c12" strokeWidth="2"/>
                        <text x="40" y="48" fill="white" fontSize="8" textAnchor="middle" fontWeight="bold">{t.includes('mg996') ? 'MG996R' : 'SG90'}</text>
                        <text x="40" y="65" fill="#81d4fa" fontSize="6" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );

                    // Physical joint placeholders (wrist, finger mechanism)
                    if (t.includes('joint') || t.includes('mechanism') || t.includes('finger')) return (
                      <svg width="100" height="40" viewBox="0 0 100 40">
                        <rect x="5" y="5" width="90" height="30" rx="15" fill="#263238" stroke="#546e7a" strokeWidth="2" strokeDasharray="4 2"/>
                        <circle cx="20" cy="20" r="6" fill="#546e7a"/>
                        <circle cx="80" cy="20" r="6" fill="#546e7a"/>
                        <line x1="26" y1="20" x2="74" y2="20" stroke="#546e7a" strokeWidth="2"/>
                        <text x="50" y="17" fill="white" fontSize="7" textAnchor="middle" fontWeight="bold">{t.replace(/_/g,' ').toUpperCase()}</text>
                        <text x="50" y="27" fill="#90a4ae" fontSize="6" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );

                    // DC Motor - circular with shaft
                    if (t.includes('motor') || t.includes('dc_motor')) return (
                      <svg width="100" height="80" viewBox="0 0 100 80">
                        <rect x="10" y="15" width="60" height="50" rx="6" fill="#4a4a4a" stroke="#888" strokeWidth="2"/>
                        <circle cx="40" cy="40" r="18" fill="#333" stroke="#aaa" strokeWidth="1.5"/>
                        <circle cx="40" cy="40" r="5" fill="#ccc"/>
                        <rect x="70" y="32" width="25" height="16" rx="3" fill="#999" stroke="#666" strokeWidth="1"/>
                        <circle cx="18" cy="20" r="4" fill="#e74c3c" stroke="white" strokeWidth="1"/><text x="18" y="14" fill="#e74c3c" fontSize="7" textAnchor="middle">+</text>
                        <circle cx="18" cy="60" r="4" fill="#333" stroke="white" strokeWidth="1"/><text x="18" y="54" fill="white" fontSize="7" textAnchor="middle">-</text>
                        <text x="40" y="75" fill="white" fontSize="8" textAnchor="middle" fontFamily="monospace">{comp.id}</text>
                      </svg>
                    );
                    // Battery
                    if (t.includes('battery') || t.includes('9v')) return (
                      <svg width="70" height="100" viewBox="0 0 70 100">
                        <rect x="15" y="20" width="40" height="70" rx="4" fill="#2c3e50" stroke="#e74c3c" strokeWidth="2"/>
                        <rect x="22" y="10" width="10" height="14" rx="2" fill="#e74c3c"/><text x="27" y="8" fill="#e74c3c" fontSize="10" textAnchor="middle">+</text>
                        <rect x="38" y="10" width="10" height="14" rx="2" fill="#333" stroke="#888" strokeWidth="1"/><text x="43" y="8" fill="white" fontSize="10" textAnchor="middle">-</text>
                        <text x="35" y="55" fill="white" fontSize="9" textAnchor="middle" fontWeight="bold">9V</text>
                        <text x="35" y="96" fill="#aaa" fontSize="7" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );
                    // L298N Motor Driver
                    if (t.includes('l298n') || t.includes('motor_driver') || t.includes('driver')) return (
                      <svg width="160" height="120" viewBox="0 0 160 120">
                        <rect x="5" y="10" width="150" height="95" rx="4" fill="#1a237e" stroke="#5c6bc0" strokeWidth="2"/>
                        <rect x="15" y="20" width="30" height="20" rx="2" fill="#333" stroke="#888" strokeWidth="1"/>
                        <text x="30" y="34" fill="white" fontSize="7" textAnchor="middle">IC</text>
                        {/* Heatsink */}
                        <rect x="55" y="18" width="50" height="35" rx="1" fill="#444" stroke="#666" strokeWidth="1"/>
                        {[0,1,2,3,4].map(i => <rect key={i} x={58+i*10} y="18" width="4" height="35" fill="#555"/>)}
                        {/* Terminal blocks */}
                        {['OUT1','OUT2','OUT3','OUT4'].map((p,i) => <g key={p}><rect x={10+i*20} y="2" width="14" height="10" fill="#27ae60" stroke="#1a1a1a" strokeWidth="1" rx="1"/><text x={17+i*20} y="9" fill="white" fontSize="5" textAnchor="middle">{p}</text></g>)}
                        {['IN1','IN2','ENA','IN3','IN4','ENB'].map((p,i) => <g key={p}><rect x={10+i*22} y="100" width="16" height="10" fill="#e67e22" stroke="#1a1a1a" strokeWidth="1" rx="1"/><text x={18+i*22} y="107" fill="white" fontSize="5" textAnchor="middle">{p}</text></g>)}
                        <text x="80" y="75" fill="white" fontSize="11" textAnchor="middle" fontWeight="bold">L298N</text>
                        <text x="80" y="90" fill="#7986cb" fontSize="7" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );
                    // IR Sensor
                    if (t.includes('ir_sensor') || t.includes('ir_line')) return (
                      <svg width="80" height="50" viewBox="0 0 80 50">
                        <rect x="5" y="5" width="70" height="35" rx="4" fill="#1b5e20" stroke="#4caf50" strokeWidth="1.5"/>
                        <circle cx="25" cy="22" r="8" fill="#111" stroke="#4caf50" strokeWidth="1"/><circle cx="25" cy="22" r="3" fill="#4caf50"/>
                        <circle cx="55" cy="22" r="8" fill="#111" stroke="#e53935" strokeWidth="1"/><circle cx="55" cy="22" r="3" fill="#e53935"/>
                        {['VCC','GND','OUT'].map((p,i) => <g key={p}><rect x={15+i*20} y="38" width="12" height="8" fill="#ffd54f" rx="1"/><text x={21+i*20} y="49" fill="#333" fontSize="5" textAnchor="middle">{p}</text></g>)}
                        <text x="40" y="14" fill="white" fontSize="7" textAnchor="middle">IR SENSOR</text>
                      </svg>
                    );
                    // Robot Chassis
                    if (t.includes('chassis') || t.includes('frame') || t.includes('body')) return (
                      <svg width="160" height="100" viewBox="0 0 160 100">
                        <rect x="20" y="15" width="120" height="65" rx="20" fill="#37474f" stroke="#78909c" strokeWidth="2"/>
                        <circle cx="35" cy="85" r="12" fill="#555" stroke="#888" strokeWidth="2"/><circle cx="35" cy="85" r="4" fill="#333"/>
                        <circle cx="125" cy="85" r="12" fill="#555" stroke="#888" strokeWidth="2"/><circle cx="125" cy="85" r="4" fill="#333"/>
                        <circle cx="80" cy="10" r="6" fill="#333" stroke="#78909c" strokeWidth="1"/>
                        <text x="80" y="52" fill="white" fontSize="10" textAnchor="middle" fontWeight="bold">CHASSIS</text>
                        <text x="80" y="65" fill="#90a4ae" fontSize="7" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );
                    // Speaker
                    if (t.includes('speaker') || t.includes('spk')) return (
                      <svg width="90" height="90" viewBox="0 0 90 90">
                        <circle cx="45" cy="45" r="40" fill="#2c3e50" stroke="#7f8c8d" strokeWidth="2"/>
                        <circle cx="45" cy="45" r="30" fill="#34495e" stroke="#95a5a6" strokeWidth="1"/>
                        <circle cx="45" cy="45" r="15" fill="#1a252f" stroke="#7f8c8d" strokeWidth="1"/>
                        <circle cx="45" cy="45" r="5" fill="#555"/>
                        {/* Concentric rings */}
                        <circle cx="45" cy="45" r="22" fill="none" stroke="#4a6fa5" strokeWidth="0.5" opacity="0.6"/>
                        <circle cx="45" cy="45" r="35" fill="none" stroke="#4a6fa5" strokeWidth="0.5" opacity="0.4"/>
                        {/* Terminals */}
                        <rect x="20" y="82" width="10" height="8" rx="1" fill="#e74c3c"/><text x="25" y="96" fill="#e74c3c" fontSize="6" textAnchor="middle">+</text>
                        <rect x="60" y="82" width="10" height="8" rx="1" fill="#555" stroke="#888" strokeWidth="0.5"/><text x="65" y="96" fill="#aaa" fontSize="6" textAnchor="middle">-</text>
                        <text x="45" y="50" fill="white" fontSize="7" textAnchor="middle" fontWeight="bold">SPK</text>
                      </svg>
                    );
                    // Capacitor
                    if (t.includes('capacitor') || t.includes('cap')) return (
                      <svg width="60" height="70" viewBox="0 0 60 70">
                        <rect x="10" y="15" width="40" height="40" rx="4" fill="#0d47a1" stroke="#42a5f5" strokeWidth="1.5"/>
                        <text x="30" y="32" fill="white" fontSize="7" textAnchor="middle" fontWeight="bold">CAP</text>
                        <text x="30" y="44" fill="#90caf9" fontSize="6" textAnchor="middle">{comp.id}</text>
                        {/* Pins with labels */}
                        <rect x="15" y="5" width="6" height="12" rx="1" fill="#ffb74d" stroke="#e65100" strokeWidth="0.5"/>
                        <text x="18" y="4" fill="#ffb74d" fontSize="6" textAnchor="middle">1</text>
                        <rect x="39" y="5" width="6" height="12" rx="1" fill="#ffb74d" stroke="#e65100" strokeWidth="0.5"/>
                        <text x="42" y="4" fill="#ffb74d" fontSize="6" textAnchor="middle">2</text>
                        <rect x="15" y="53" width="6" height="12" rx="1" fill="#ffb74d" stroke="#e65100" strokeWidth="0.5"/>
                        <rect x="39" y="53" width="6" height="12" rx="1" fill="#ffb74d" stroke="#e65100" strokeWidth="0.5"/>
                      </svg>
                    );
                    // LM386 or any IC
                    if (t.includes('lm386') || t.includes('lm') || t.includes('op_amp') || t.includes('ic_')) return (
                      <svg width="100" height="80" viewBox="0 0 100 80">
                        <rect x="15" y="10" width="70" height="55" rx="3" fill="#1a1a2e" stroke="#e94560" strokeWidth="1.5"/>
                        <circle cx="25" cy="18" r="3" fill="none" stroke="#e94560" strokeWidth="1"/>
                        {/* Left pins 1-4 */}
                        {[1,2,3,4].map((p,i) => <g key={`l${p}`}><rect x="5" y={16+i*12} width="12" height="4" rx="1" fill="#c0c0c0" stroke="#888" strokeWidth="0.5"/><text x="3" y={20+i*12} fill="#aaa" fontSize="5" textAnchor="end">{p}</text></g>)}
                        {/* Right pins 8-5 */}
                        {[8,7,6,5].map((p,i) => <g key={`r${p}`}><rect x="83" y={16+i*12} width="12" height="4" rx="1" fill="#c0c0c0" stroke="#888" strokeWidth="0.5"/><text x="97" y={20+i*12} fill="#aaa" fontSize="5">{p}</text></g>)}
                        <text x="50" y="42" fill="white" fontSize="9" textAnchor="middle" fontWeight="bold">{t.replace(/_/g,' ').toUpperCase()}</text>
                        <text x="50" y="56" fill="#e94560" fontSize="6" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );
                    // Transistor
                    if (t.includes('transistor') || t.includes('mosfet') || t.includes('bjt')) return (
                      <svg width="60" height="70" viewBox="0 0 60 70">
                        <rect x="15" y="10" width="30" height="40" rx="3" fill="#263238" stroke="#78909c" strokeWidth="1.5"/>
                        <text x="30" y="32" fill="white" fontSize="7" textAnchor="middle" fontWeight="bold">Q</text>
                        {['B','C','E'].map((p,i) => <g key={p}><rect x={10+i*16} y="48" width="8" height="12" rx="1" fill="#c0c0c0"/><text x={14+i*16} y="66" fill="#aaa" fontSize="6" textAnchor="middle">{p}</text></g>)}
                        <text x="30" y="8" fill="#78909c" fontSize="6" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );
                    // Audio source / microphone
                    if (t.includes('audio') || t.includes('microphone') || t.includes('mic')) return (
                      <svg width="60" height="70" viewBox="0 0 60 70">
                        <circle cx="30" cy="28" r="18" fill="#263238" stroke="#4dd0e1" strokeWidth="1.5"/>
                        <rect x="25" y="18" width="10" height="20" rx="5" fill="#4dd0e1" opacity="0.7"/>
                        <rect x="28" y="46" width="4" height="10" fill="#4dd0e1"/>
                        <rect x="22" y="54" width="16" height="3" rx="1" fill="#4dd0e1"/>
                        {['1','2'].map((p,i) => <g key={p}><rect x={15+i*22} y="60" width="8" height="8" rx="1" fill="#ffb74d"/><text x={19+i*22} y="72" fill="#ffb74d" fontSize="6" textAnchor="middle">{p}</text></g>)}
                      </svg>
                    );
                    // Raspberry Pi
                    if (t.includes('raspberry') || t.includes('rpi') || t.includes('pi_4') || t.includes('pi_3')) return (
                      <svg width="220" height="150" viewBox="0 0 220 150">
                        {/* Main PCB board */}
                        <rect x="10" y="10" width="200" height="130" rx="10" fill="#2e7d32" stroke="#1b5e20" strokeWidth="2"/>
                        
                        {/* GPIO Pins Header */}
                        <rect x="25" y="15" width="150" height="15" fill="#111" stroke="#333" strokeWidth="1"/>
                        {[...Array(20)].map((_, i) => (
                          <g key={`gpio1-${i}`}>
                            <rect x={28 + i * 7.3} y="17" width="3" height="4" fill="#ffd700"/>
                            <rect x={28 + i * 7.3} y="24" width="3" height="4" fill="#ffd700"/>
                          </g>
                        ))}
                        <text x="100" y="12" fill="white" fontSize="6" textAnchor="middle">GPIO PINS</text>
                        
                        {/* CPU / SoC */}
                        <rect x="95" y="55" width="35" height="35" rx="2" fill="#263238" stroke="#37474f" strokeWidth="1"/>
                        <text x="112.5" y="70" fill="#78909c" fontSize="6" textAnchor="middle">BROADCOM</text>
                        <text x="112.5" y="80" fill="white" fontSize="5" textAnchor="middle">ARM CORTEX</text>

                        {/* RAM */}
                        <rect x="145" y="60" width="20" height="25" rx="1" fill="#263238" stroke="#37474f" strokeWidth="1"/>

                        {/* USB Ports */}
                        <rect x="180" y="40" width="30" height="35" rx="2" fill="#b0bec5" stroke="#78909c" strokeWidth="1"/>
                        <rect x="180" y="80" width="30" height="35" rx="2" fill="#b0bec5" stroke="#78909c" strokeWidth="1"/>
                        <text x="195" y="60" fill="#111" fontSize="8" textAnchor="middle" fontWeight="bold">USB</text>
                        <text x="195" y="100" fill="#111" fontSize="8" textAnchor="middle" fontWeight="bold">USB</text>
                        
                        {/* Ethernet */}
                        <rect x="175" y="15" width="35" height="20" rx="2" fill="#cfd8dc" stroke="#90a4ae" strokeWidth="1"/>
                        <text x="192.5" y="27" fill="#111" fontSize="6" textAnchor="middle" fontWeight="bold">ETH</text>

                        {/* HDMI & USB-C Power */}
                        <rect x="70" y="130" width="25" height="15" fill="#cfd8dc"/>
                        <text x="82.5" y="140" fill="#111" fontSize="5" textAnchor="middle">HDMI 1</text>
                        <rect x="105" y="130" width="25" height="15" fill="#cfd8dc"/>
                        <text x="117.5" y="140" fill="#111" fontSize="5" textAnchor="middle">HDMI 2</text>
                        
                        <rect x="25" y="130" width="18" height="12" fill="#424242"/>
                        <text x="34" y="125" fill="white" fontSize="5" textAnchor="middle">POWER</text>

                        {/* Raspberry Pi Logo Motif */}
                        <circle cx="45" cy="80" r="12" fill="#e91e63"/>
                        <path d="M 40 70 Q 45 60 50 70" fill="#4caf50"/>

                        <text x="100" y="45" fill="white" fontSize="12" textAnchor="middle" fontWeight="bold">Raspberry Pi 4</text>
                        <text x="100" y="125" fill="#c8e6c9" fontSize="8" textAnchor="middle">{comp.id}</text>
                      </svg>
                    );

                    // Generic fallback - shows actual component name, not "CUSTOM SVG"
                    const fallbackName = comp.label || comp.custom?.description || comp.value || t;
                    const label = String(fallbackName).replace(/_/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    return (
                      <svg width="140" height="90" viewBox="0 0 140 90">
                        <defs>
                          <linearGradient id={`grad-${comp.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1e3a5f"/>
                            <stop offset="100%" stopColor="#0d1b2a"/>
                          </linearGradient>
                        </defs>
                        <rect x="5" y="10" width="130" height="65" rx="6" fill={`url(#grad-${comp.id})`} stroke="#3498db" strokeWidth="2"/>
                        <rect x="5" y="10" width="130" height="18" rx="6" fill="#3498db" opacity="0.15"/>
                        <text x="70" y="24" fill="#7fb3d3" fontSize="7" fontFamily="monospace" textAnchor="middle">{comp.id}</text>
                        <text x="70" y="48" fill="white" fontSize={label.length > 14 ? "8" : "11"} fontFamily="monospace" textAnchor="middle" fontWeight="bold">{label}</text>
                        {[0,1,2,3,4,5].map(i => <rect key={`t${i}`} x={18+i*20} y="2" width="6" height="10" rx="1" fill="#c0c0c0" stroke="#888" strokeWidth="0.5"/>)}
                        {[0,1,2,3,4,5].map(i => <rect key={`b${i}`} x={18+i*20} y="73" width="6" height="10" rx="1" fill="#c0c0c0" stroke="#888" strokeWidth="0.5"/>)}
                      </svg>
                    );
                  })()
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
        </div>
      </div>

      {breadboardPosition && wirePaths.length > 0 && (
        <motion.div
          drag
          dragControls={routingPanelDragControls}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={containerRef}
          data-canvas-overlay="true"
          onWheel={event => event.stopPropagation()}
          style={{ overscrollBehavior: 'contain' }}
          className="absolute right-3 top-3 z-30 w-[min(360px,calc(100%-24px))] overflow-hidden rounded-xl border border-neutral-800 bg-[#090909]/95 shadow-2xl backdrop-blur-md"
        >
          <div className="border-b border-gray-800 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm border border-gray-300 bg-[#e3e7e1] shadow-[0_0_10px_rgba(220,230,220,0.22)]" />
                <h3 className="text-[11px] font-semibold tracking-wide text-gray-100">Auto breadboard routing</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[9px] font-medium text-gray-300">{wirePaths.length} wires</span>
                <button
                  type="button"
                  onPointerDown={event => { event.stopPropagation(); routingPanelDragControls.start(event); }}
                  style={{ touchAction: 'none' }}
                  title="Move routing panel"
                  aria-label="Move routing panel"
                  className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white cursor-grab active:cursor-grabbing"
                ><Move size={12} /></button>
              </div>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">Each wire uses one isolated five-hole strip. Select a row to highlight both exact device pins.</p>
          </div>
          <div className="max-h-[34vh] space-y-1 overflow-y-auto p-2" style={{ overscrollBehavior: 'contain' }} onWheel={event => event.stopPropagation()}>
            {wirePaths.map(wire => (
              <button
                key={wire.id}
                type="button"
                aria-pressed={selectedWireId === wire.id}
                onClick={() => { setSelectedWireId(wire.id); setSelectedComponentId(null); }}
                className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors ${selectedWireId === wire.id ? 'border-neutral-600 bg-white/[0.07]' : 'border-transparent bg-white/[0.025] hover:border-neutral-700 hover:bg-white/[0.05]'}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: wire.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10px] text-gray-200" title={`${wire.fromComp}:${wire.fromPin} → ${wire.toComp}:${wire.labelText}`}>
                    {wire.fromComp}:<strong className="text-white">{wire.fromPin}</strong>
                    <span className="px-1.5 text-gray-500">→</span>
                    {wire.toComp}:<strong className="text-white">{wire.labelText}</strong>
                  </span>
                  <span className="mt-1 block text-[9px] text-gray-500">Breadboard holes: <span className="font-mono text-gray-300">{wire.breadboardFrom?.label} ↔ {wire.breadboardTo?.label}</span></span>
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Zoom Controls - Bottom Left Corner */}
      <div data-canvas-overlay="true" className="absolute bottom-4 left-4 z-30 flex items-center gap-1 bg-[#111]/80 backdrop-blur-md border border-gray-700 rounded-lg p-1 shadow-lg">
        <button 
          onClick={() => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            setTransform(p => {
              const newScale = Math.min(4.5, p.scale * 1.25);
              const ratio = newScale / p.scale;
              return { x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio, scale: newScale };
            });
          }} 
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors cursor-pointer" 
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1"></div>
        <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors cursor-pointer" title="Reset View">
          <Maximize size={16} />
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1"></div>
        <button 
          onClick={() => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            setTransform(p => {
              const newScale = Math.max(0.15, p.scale / 1.25);
              const ratio = newScale / p.scale;
              return { x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio, scale: newScale };
            });
          }} 
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors cursor-pointer" 
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
      </div>

      {/* Step Controller */}
      {data && data.steps.length > 0 && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={containerRef}
          data-canvas-overlay="true"
          onWheel={event => event.stopPropagation()}
          className={`absolute ${dockPosition === 'bottom-right' ? 'bottom-10 right-6 items-end' : 'top-4 left-4 items-start'} z-30 flex flex-col gap-2 max-h-[calc(100vh-32px)] pointer-events-none`}
        >
          {/* We wrap children in a pointer-events-auto div to allow interaction while keeping the wrapper strictly for layout */}
          {/* Expanded step detail panel (toggle) */}
          <AnimatePresence>
            {(selectedComponentId || selectedWireId) && (
              <motion.div
                initial={{ opacity: 0, y: 10, x: 20 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, y: 10, x: 20 }}
                data-canvas-overlay="true"
                onWheel={event => event.stopPropagation()}
                style={{ overscrollBehavior: 'contain' }}
                className="bg-[#0a0a0a]/95 backdrop-blur-md border border-neutral-800 rounded-xl p-3 w-[260px] shadow-2xl mb-2 pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-800">
                  <h3 className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                    <Search size={14} /> Inspect: {selectedWireId ? 'Wire Connection' : selectedComponentId}
                  </h3>
                  <button onClick={() => { setSelectedComponentId(null); setSelectedWireId(null); }} className="text-gray-500 hover:text-white">
                    <X size={14} />
                  </button>
                </div>
                
                <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1" style={{ overscrollBehavior: 'contain' }} onWheel={event => event.stopPropagation()}>
                  {selectedWireId ? (
                    (() => {
                      const w = wirePaths.find(w => w.id === selectedWireId);
                      if (!w) return null;
                      return (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                            <div className="flex flex-col text-left">
                              <span className="text-[10px] text-gray-500 truncate max-w-[80px]" title={w.fromComp}>{w.fromComp}</span>
                              <span className="text-xs font-mono font-bold text-gray-300">{w.fromPin}</span>
                            </div>
                            <div className="flex-1 px-4 flex items-center justify-center relative">
                              <div className="w-full h-px border-t border-dashed border-gray-600"></div>
                              <div className="absolute w-2 h-2 rounded-full" style={{ backgroundColor: w.color }}></div>
                            </div>
                            <div className="flex flex-col text-right">
                              <span className="text-[10px] text-gray-500 truncate max-w-[80px]" title={w.toComp}>{w.toComp}</span>
                              <span className="text-xs font-mono font-bold text-gray-300">{w.labelText}</span>
                            </div>
                          </div>
                          
                          <div className="bg-[#141414]/80 rounded-lg p-2.5 border border-neutral-800">
                            <h4 className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold mb-1.5">Estimated Telemetry</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {Object.entries(getWireStats(w.color, w.fromPin, w.labelText)).map(([k, v]) => (
                                <div key={k} className="flex flex-col">
                                  <span className="text-[9px] text-gray-500">{k}</span>
                                  <span className="text-[10px] text-gray-300 font-medium">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex flex-col gap-3">
                      {(() => {
                        const compDef = accumulatedState.components.find((component: any) => component.id === selectedComponentId);
                        if (!compDef) return null;
                        return (
                          <div className="bg-[#141414]/80 rounded-lg p-2.5 border border-neutral-800">
                            <h4 className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold mb-1.5">Component Specs</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {Object.entries(getComponentStats(compDef.type)).map(([k, v]) => (
                                <div key={k} className="flex flex-col">
                                  <span className="text-[9px] text-gray-500">{k}</span>
                                  <span className="text-[10px] text-gray-300 font-medium">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      
                      <div className="space-y-1.5">
                        <h4 className="text-[9px] uppercase tracking-wider text-gray-400 font-bold px-1">Connections</h4>
                        {selectedComponentConnections.length === 0 ? (
                          <div className="text-[10px] text-gray-500 italic py-2 text-center">No wires connected in this step</div>
                        ) : (
                          selectedComponentConnections.map(connection => {
                            return (
                              <div key={connection.id} className="text-[10px] flex items-center justify-between bg-gray-900/50 px-2 py-1.5 rounded">
                                <span className="font-mono text-gray-300 font-bold">{connection.myPin}</span>
                                <div className="flex-1 border-b border-dashed border-gray-700 mx-2"></div>
                                <span className="text-gray-400 truncate max-w-[100px]" title={`${connection.otherComp}:${connection.otherPin}`}>
                                  {connection.otherComp}:<span className="font-mono text-gray-300">{connection.otherPin}</span>
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {expandedPanel && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                data-canvas-overlay="true"
                onWheel={event => event.stopPropagation()}
                style={{ overscrollBehavior: 'contain' }}
                className="bg-[#111]/95 backdrop-blur-md border border-gray-700 rounded-xl p-4 w-[300px] max-h-[50vh] overflow-y-auto shadow-2xl pointer-events-auto"
              >
                <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-3">All Steps</h3>
                <div className="space-y-1.5">
                  {data.steps.map((step, i) => {
                    const isComp = step.add_components && step.add_components.length > 0;
                    const isWire = step.add_wiring && step.add_wiring.length > 0;
                    const isDone = i < currentStepIndex;
                    const isCurrent = i === currentStepIndex;
                    return (
                      <button
                        key={i}
                        onClick={() => setCurrentStepIndex(i)}
                        className={`w-full text-left flex items-start gap-2 p-2 rounded-lg text-xs transition-all ${
                          isCurrent ? 'bg-white/[0.07] border border-neutral-600 text-white' :
                          isDone ? 'text-gray-400 hover:bg-gray-800/50' : 'text-gray-600 hover:bg-gray-800/30'
                        }`}
                      >
                        <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{
                          background: isDone ? '#525252' : isCurrent ? '#737373' : '#262626',
                          color: 'white'
                        }}>
                          {isDone ? '✓' : i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {step.phase && <span className="text-[8px] font-bold uppercase text-gray-500 bg-gray-800 px-1 rounded">{step.phase}</span>}
                            {step.code && <span className="text-[8px] text-neutral-400">{'</>'}</span>}
                          </div>
                          <span className="block truncate">{step.instruction || `Step ${i+1}`}</span>
                          <span className="text-[10px] text-gray-500 mt-0.5 flex gap-2">
                            {isComp && <span>{step.add_components?.length || 0} part{(step.add_components?.length || 0) > 1 ? 's' : ''}</span>}
                            {isWire && <span>{step.add_wiring?.length || 0} wire{(step.add_wiring?.length || 0) > 1 ? 's' : ''}</span>}
                            {step.code && <span>code</span>}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Compact step bar */}
          <div className="bg-[#111]/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl flex items-center gap-2 px-3 py-2 pointer-events-auto">
            <button 
              onPointerDown={(e) => dragControls.start(e)}
              style={{ touchAction: 'none' }}
              title="Move step controls and details"
              className="p-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 mr-1 cursor-grab active:cursor-grabbing pointer-events-auto"
            >
              <Move size={14} />
            </button>
            <button 
              onClick={() => setCurrentStepIndex(0)}
              disabled={currentStepIndex === 0}
              title="Restart from Step 1"
              className="p-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <SkipBack size={14} />
            </button>
            <button 
              onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))}
              disabled={currentStepIndex === 0}
              className="p-1.5 bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>

            {/* Step progress dots */}
            <button 
              onClick={() => setExpandedPanel(!expandedPanel)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-800/50 transition-colors"
            >
              <span className="text-xs font-bold text-white">{currentStepIndex + 1}/{data.steps.length}</span>
              <ChevronUp size={12} className={`text-gray-500 transition-transform ${expandedPanel ? 'rotate-180' : ''}`} />
            </button>
            
            <button 
              onClick={() => setCurrentStepIndex(Math.min(data.steps.length - 1, currentStepIndex + 1))}
              disabled={currentStepIndex === data.steps.length - 1}
              title="Next step"
              aria-label="Next step"
              className="p-1.5 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
            
            {(() => {
              const currentStep = data.steps[currentStepIndex];
              if (!currentStep) return null;
              
              let hasCode = !!currentStep.code;
              let extractedCode = currentStep.code ? currentStep.code.replace(/\\n/g, '\n') : '';
              
              if (!hasCode && currentStep.detail) {
                const codeRegex = /```(\w*)\s*([\s\S]*?)```/g;
                let match;
                while ((match = codeRegex.exec(currentStep.detail)) !== null) {
                  hasCode = true;
                  extractedCode = match[2].trim();
                }
              }

              if (!hasCode) return null;

              return (
                <button 
                  onClick={() => {
                    if (extractedCode && onCompileRequest) {
                      onCompileRequest(extractedCode);
                    } else {
                      alert('No code found on this step.');
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-300 ${
                    isBoardConnected
                      ? 'bg-[#111] text-white hover:bg-[#1a1a1a] border border-neutral-700'
                      : 'bg-gray-800 text-gray-500 hover:bg-gray-700 border border-gray-800'
                  }`}
                  title={isBoardConnected ? 'Use Kaktus to compile and flash this step to the detected board' : 'Connect your Arduino by USB, then use Kaktus Flash to Board'}
                >
                  <Zap size={12} className={isBoardConnected ? 'text-neutral-200' : ''} /> Flash in Kaktus
                </button>
              );
            })()}
          </div>
          
          {/* Current step info panel */}
          {(() => {
            const step = data.steps[currentStepIndex];
            if (!step) return null;
            const pc = 'bg-gray-800 text-gray-200 border-gray-700';
            return (
              <motion.div
                drag
                dragControls={stepInfoDragControls}
                dragListener={false}
                dragMomentum={false}
                dragConstraints={containerRef}
                data-canvas-overlay="true"
                onWheel={event => event.stopPropagation()}
                style={{ overscrollBehavior: 'contain' }}
                className="bg-[#0a0a0a]/95 backdrop-blur-sm border border-neutral-800 rounded-xl px-3 py-2.5 max-w-[340px] shadow-lg space-y-2 pointer-events-auto"
              >
                {/* Phase badge + instruction */}
                <div className="flex items-start gap-2">
                  {step.phase && (
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${pc}`}>
                      {step.phase}
                    </span>
                  )}
                  <p className="flex-1 text-xs text-gray-200 font-medium leading-relaxed">{step.instruction}</p>
                  <button
                    type="button"
                    onPointerDown={event => { event.stopPropagation(); stepInfoDragControls.start(event); }}
                    style={{ touchAction: 'none' }}
                    title="Move this step info panel"
                    aria-label="Move this step info panel"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white cursor-grab active:cursor-grabbing"
                  ><Move size={12} /></button>
                </div>
                
                                {(() => {
                  // The AI sometimes buries markdown code blocks inside step.detail. We need to extract them.
                  const detailText = step.detail || '';
                  const codeBlockRegex = /```(\w*)\s*([\s\S]*?)```/g;
                  let match;
                  let lastIndex = 0;
                  const parts = [];
                  let extractedCode = step.code ? step.code.replace(/\\n/g, '\n') : null;
                  let extractedLang = step.code_language || 'cpp';

                  while (!step.code && (match = codeBlockRegex.exec(detailText)) !== null) {
                    if (match.index > lastIndex) {
                      parts.push(<span key={lastIndex}>{detailText.slice(lastIndex, match.index)}</span>);
                    }
                    extractedCode = match[2].trim();
                    extractedLang = match[1] || 'cpp';
                    lastIndex = match.index + match[0].length;
                  }
                  if (lastIndex < detailText.length) {
                    parts.push(<span key={lastIndex}>{detailText.slice(lastIndex)}</span>);
                  }

                  return (
                    <div className="max-h-[300px] overflow-y-auto pr-1" style={{ overscrollBehavior: 'contain' }} onWheel={event => event.stopPropagation()}>
                      {parts.length > 0 && (
                        <p className="text-[11px] text-gray-500 leading-relaxed border-l-2 border-gray-700 pl-2 whitespace-pre-wrap">
                          {parts}
                        </p>
                      )}
                      
                      {extractedCode && (
                        <div className="bg-[#0a0a0a] rounded-lg p-2 border border-gray-800 shadow-inner mt-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] text-gray-400 font-mono uppercase tracking-wider bg-gray-900 px-1.5 py-0.5 rounded border border-gray-700">{extractedLang}</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openCodePreview(extractedCode!, extractedLang, currentStepIndex)}
                                className="flex items-center gap-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-2 py-1 rounded text-[9px] font-medium transition-colors border border-neutral-700"
                                title="Preview code in editor"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                                Preview
                              </button>
                              <button
                                onClick={() => navigator.clipboard.writeText(extractedCode!)}
                                className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded text-[9px] font-medium transition-colors border border-gray-700"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                Copy
                              </button>
                            </div>
                          </div>
                          <pre className="text-[10px] font-mono text-gray-300 max-h-[160px] overflow-y-auto overflow-x-auto whitespace-pre-wrap p-1 bg-black/40 rounded" style={{ overscrollBehavior: 'contain' }} onWheel={event => event.stopPropagation()}>
                            <code dangerouslySetInnerHTML={{ __html: highlightCode(extractedCode) }} />
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* Verification */}
                {step.verify && (
                  <div className="flex items-start gap-1.5 text-[11px] text-gray-300 bg-gray-900 rounded-lg px-2 py-1.5 border border-gray-700">
                    <span className="flex-shrink-0 mt-0.5 text-gray-400"><CheckCircle2 size={12}/></span>
                    <div className="flex-1 overflow-hidden relative">
                      <div className="line-clamp-4">{step.verify}</div>
                      {step.verify.length > 150 && (
                        <button
                          onClick={() => setExpandedVerifyText(step.verify!)}
                          className="mt-1 text-neutral-300 hover:text-white text-[9px] flex items-center gap-1 font-medium bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-700"
                        >
                          <Maximize size={10} /> Full Screen
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })()}

          {/* Inline Canvas Chat */}
          <AnimatePresence>
            {canvasChatOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 10, height: 0 }}
                data-canvas-overlay="true"
                onWheel={event => event.stopPropagation()}
                style={{ overscrollBehavior: 'contain' }}
                className="bg-[#090909]/95 backdrop-blur-md border border-neutral-800 rounded-xl max-w-[380px] shadow-2xl overflow-hidden"
              >
                {/* Chat Messages */}
                <div ref={canvasChatRef} className="max-h-[200px] overflow-y-auto p-2 space-y-2" style={{ overscrollBehavior: 'contain' }} onWheel={event => event.stopPropagation()}>
                  {canvasChatMessages.length === 0 && (
                    <p className="text-[10px] text-gray-600 text-center py-3">
                      Ask anything about this circuit, or request changes...
                    </p>
                  )}
                  {canvasChatMessages.map((msg, i) => (
                    <div key={i} className={`text-[11px] leading-relaxed px-2 py-1.5 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-white/[0.07] text-neutral-200 ml-6'
                        : 'bg-gray-800/50 text-gray-300 mr-4'
                    }`}>
                      {msg.text}
                    </div>
                  ))}
                  {canvasChatLoading && (
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 px-2">
                      <Loader2 size={10} className="animate-spin" /> Thinking...
                    </div>
                  )}
                </div>
                {/* Chat Input */}
                <div className="flex items-center gap-1.5 p-1.5 border-t border-gray-800/50">
                  <input
                    value={canvasChatInput}
                    onChange={e => setCanvasChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCanvasChat()}
                    placeholder="Ask or change anything..."
                    className="flex-1 bg-transparent text-xs text-white placeholder-gray-600 outline-none px-2 py-1.5"
                    disabled={canvasChatLoading || !apiKeys || apiKeys.length === 0}
                  />
                  <button
                    onClick={handleCanvasChat}
                    disabled={!canvasChatInput.trim() || canvasChatLoading || !apiKeys || apiKeys.length === 0}
                    className="p-1.5 rounded-lg bg-neutral-200 hover:bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={10} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Toggle Button */}
          <button
            onClick={() => setCanvasChatOpen(!canvasChatOpen)}
            className={`self-end p-2 rounded-full transition-all shadow-lg ${
              canvasChatOpen 
                ? 'bg-neutral-200 text-black ring-2 ring-white/20'
                : 'bg-[#111]/90 text-gray-400 hover:text-white hover:bg-[#181818] border border-neutral-800'
            }`}
            title="Canvas AI Chat"
          >
            {canvasChatOpen ? <X size={14} /> : <MessageCircle size={14} />}
          </button>
        </motion.div>
      )}

      {/* VS Code-like Code Preview Overlay */}
      <AnimatePresence>
        {previewCode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-canvas-overlay="true"
            onWheel={event => event.stopPropagation()}
            style={{ overscrollBehavior: 'contain' }}
            className="absolute inset-0 z-[200] bg-[#090909] flex flex-col"
          >
            {/* Title Bar */}
            <div className="flex items-center justify-between h-9 bg-[#141414] border-b border-neutral-800 px-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button type="button" title="Close editor" aria-label="Close editor" className="w-3 h-3 rounded-full bg-neutral-500 hover:bg-neutral-300" onClick={closeCodePreview} />
                  <span className="w-3 h-3 rounded-full bg-neutral-700" />
                  <span className="w-3 h-3 rounded-full bg-neutral-800" />
                </div>
                <span className="text-[11px] text-gray-400 font-medium ml-2">
                  {data?.project_name || 'sketch'}.{previewCode.language === 'python' ? 'py' : previewCode.language === 'cpp' ? 'ino' : previewCode.language}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(previewCode.code)}
                  className="flex items-center gap-1.5 text-[10px] text-gray-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 rounded transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  Copy All
                </button>
                <button
                  onClick={() => {
                    setPreviewCode(current => current ? { ...current, code: '' } : current);
                    setCodeSaveStatus('Code cleared in preview; save to remove it from this step.');
                  }}
                  className="text-[10px] text-gray-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 rounded transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={savePreviewCodeToCircuit}
                  className="text-[10px] font-medium text-black bg-neutral-200 hover:bg-white px-2.5 py-1 rounded transition-colors"
                >
                  Save to step {previewCode.stepIndex + 1}
                </button>
                {onCompileRequest && isArduinoCodePreview && (
                  <button
                    onClick={flashPreviewCodeInApp}
                    disabled={!previewCode.code.trim()}
                    className="text-[10px] font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded transition-colors"
                    title="Compile and flash using Kaktus in-app controls"
                  >
                    Flash in Kaktus
                  </button>
                )}
                <button
                  onClick={closeCodePreview}
                  className="text-gray-400 hover:text-white p-1 rounded hover:bg-neutral-800 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Breadcrumb Bar */}
            <div className="flex items-center h-6 bg-[#101010] border-b border-neutral-800 px-3 text-[10px] text-gray-500 gap-1 shrink-0">
              <span className="text-gray-400">{data?.project_name || 'Project'}</span>
              <span>›</span>
              <span className="text-gray-400">src</span>
              <span>›</span>
              <span className="text-neutral-300">
                {data?.project_name?.replace(/\s+/g, '_').toLowerCase() || 'sketch'}.{previewCode.language === 'python' ? 'py' : previewCode.language === 'cpp' ? 'ino' : previewCode.language}
              </span>
            </div>

            {isArduinoCodePreview && <div className="shrink-0 border-b border-neutral-800 bg-[#111] px-4 py-2 text-[10px] leading-relaxed text-gray-400">
              <p className="text-gray-300">
                Test target: <span className="text-neutral-200">{data?.project_name || 'Current module'}</span>
                {' · '}Step {previewCode.stepIndex + 1}/{data?.steps.length || 1}
                {data?.steps[previewCode.stepIndex]?.phase ? ` · ${data.steps[previewCode.stepIndex].phase}` : ''}
                {data?.steps[previewCode.stepIndex]?.instruction ? ` — ${data.steps[previewCode.stepIndex].instruction}` : ''}
              </p>
              <p>Save edits to this step, then use Flash in Kaktus → choose the board and USB port → Flash → Serial Monitor. Compile success alone does not confirm a physical hardware test.</p>
              <p className="mt-0.5 text-neutral-300">{codeSaveStatus}</p>
            </div>}

            {/* Code Editor Area */}
            <div className="flex flex-1 min-h-0 overflow-hidden bg-[#090909] font-mono text-[12px] leading-[20px]">
              <div className="relative w-[58px] shrink-0 overflow-hidden border-r border-neutral-800 bg-[#0d0d0d] text-right text-[11px] text-gray-600 select-none">
                <div ref={previewLineNumberRef} className="absolute top-0 left-0 w-full px-3 py-2">
                  {previewCode.code.split('\n').map((_, index) => <div key={index} className="h-[20px]">{index + 1}</div>)}
                </div>
              </div>
              <div className="relative flex-1 min-w-0 overflow-hidden">
                <pre
                  ref={previewCodeLayerRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 left-0 m-0 min-h-full min-w-max whitespace-pre px-4 py-2 pr-8 font-mono text-[12px] leading-[20px] text-neutral-300"
                  dangerouslySetInnerHTML={{ __html: highlightCode(previewCode.code) }}
                />
                <textarea
                  aria-label="Edit Arduino code"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  wrap="off"
                  value={previewCode.code}
                  onChange={event => {
                    setPreviewCode(current => current ? { ...current, code: event.target.value } : current);
                    setCodeSaveStatus('Unsaved code edits. Save to update this circuit step.');
                  }}
                  onScroll={syncCodePreviewScroll}
                  onWheel={event => event.stopPropagation()}
                  className="absolute inset-0 z-10 h-full w-full resize-none overflow-auto whitespace-pre border-0 bg-transparent px-4 py-2 pr-8 font-mono text-[12px] leading-[20px] text-transparent caret-white outline-none selection:bg-white/20"
                  style={{ tabSize: 2, overscrollBehavior: 'contain' }}
                />
              </div>
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between h-6 bg-[#141414] border-t border-neutral-800 px-3 text-[10px] text-gray-400 shrink-0">
              <div className="flex items-center gap-3">
                <span>{previewCode.language.toUpperCase()}</span>
                <span>{previewCode.code.split('\n').length} lines</span>
              </div>
              <div className="flex items-center gap-3">
                <span>UTF-8</span>
                <span>Spaces: 2</span>
                <span>Kaktus IDE</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded Verification Modal */}
      {expandedVerifyText && (
        <div data-canvas-overlay="true" onWheel={event => event.stopPropagation()} className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#111] border border-gray-700 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[85vh]" style={{ overscrollBehavior: 'contain' }}>
            <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-[#1a1a1a]">
              <h3 className="text-white font-bold flex items-center gap-2"><CheckCircle2 className="text-neutral-300" /> Verification Details</h3>
              <button onClick={() => setExpandedVerifyText(null)} className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"><X size={20}/></button>
            </div>
            <div className="p-6 overflow-y-auto text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
              {expandedVerifyText}
            </div>
            <div className="p-4 border-t border-gray-800 bg-[#1a1a1a] flex justify-end">
              <button
                onClick={() => setExpandedVerifyText(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {!data && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 font-medium text-sm">
          Ask the agent to build a circuit...
        </div>
      )}
    </div>
  );
}
