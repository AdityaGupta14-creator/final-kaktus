'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { PCBChatBox } from '@/components/PCBChatBox';
import { ModelSelector } from '@/components/ModelSelector';
import {
  ArrowLeft, CircuitBoard, Eye, EyeOff, MessageSquare, Layers,
  MousePointer2, Move, Crosshair, Ruler, Grid3X3, Search,
  ChevronDown, Box, Cpu, Zap, Radio, ToggleLeft, Disc, Package, Settings
} from 'lucide-react';
import Link from 'next/link';
import { getApiPool } from '@/lib/admin';

const PCBCanvas = dynamic(() => import('@/components/PCBCanvas').then((mod) => mod.PCBCanvas), { ssr: false });

// ─── Layer config ───
const LAYER_CONFIG = [
  { key: 'topCopper', label: 'Top Copper', color: '#ff3333', shortcut: 'F5' },
  { key: 'bottomCopper', label: 'Bottom Copper', color: '#3366ff', shortcut: 'F6' },
  { key: 'silkscreen', label: 'Silkscreen', color: '#ffff00', shortcut: 'F7' },
  { key: 'solderMask', label: 'Solder Mask', color: '#00aa44', shortcut: 'F8' },
  { key: 'drill', label: 'Drill/Via', color: '#ffffff', shortcut: 'F9' },
];

// ─── Component library categories ───
const COMP_LIBRARY = [
  { cat: 'ICs & MCUs', icon: Cpu, items: ['ATmega328P', 'STM32F103', 'ESP32', 'CH340G', 'LM7805', 'AMS1117', 'NE555', 'LM358'] },
  { cat: 'Passives', icon: Package, items: ['Resistor 0603', 'Resistor 0805', 'Capacitor 0603', 'Capacitor 0805', 'Inductor 1210'] },
  { cat: 'Connectors', icon: Grid3X3, items: ['USB-C', 'Micro-USB', 'Barrel Jack', 'Header 1x6', 'Header 2x3', 'Header 1x8', 'JST-XH 2P'] },
  { cat: 'Discrete', icon: Zap, items: ['LED 0805', 'Diode 1N4148', 'Zener 5.1V', 'MOSFET N-CH', '2N3904 NPN', '2N3906 PNP'] },
  { cat: 'Electromech', icon: ToggleLeft, items: ['Tactile Switch', 'Slide Switch', 'Buzzer', 'Relay 5V'] },
  { cat: 'Oscillators', icon: Radio, items: ['Crystal 8MHz', 'Crystal 16MHz', 'Crystal 32.768kHz'] },
];

export default function PCBDesignerPage() {
  const [apiKeys, setApiKeys] = useState<string[]>(['server_managed']);
  const [selectedModel, setSelectedModel] = useState('models/gemini-3.5-flash');
  
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isDraggingSidebar = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      const newWidth = Math.max(240, Math.min(e.clientX, window.innerWidth * 0.5));
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
      getApiPool().then(pool => {
        if (pool && pool.length > 0) {
          setApiKeys(pool.map((p: any) => p.key));
        } else {
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
  

  const [pcbData, setPcbData] = useState<any | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [leftPanel, setLeftPanel] = useState<'chat' | 'library'>('chat');
  const [expandedCat, setExpandedCat] = useState<string | null>('ICs & MCUs');
  const [libSearch, setLibSearch] = useState('');
  const [layers, setLayers] = useState({
    topCopper: true, bottomCopper: true, silkscreen: true, solderMask: true, drill: true
  });

  const handlePCBUpdate = useCallback((data: any) => {
    setPcbData(data);
    setCurrentStep((data.steps?.length || 1) - 1);
  }, []);

  const totalSteps = pcbData?.steps?.length || 0;
  const toggleLayer = (key: string) => setLayers(p => ({ ...p, [key]: !p[key as keyof typeof p] }));

  // Filter library
  const filteredLib = libSearch
    ? COMP_LIBRARY.map(c => ({ ...c, items: c.items.filter(i => i.toLowerCase().includes(libSearch.toLowerCase())) })).filter(c => c.items.length > 0)
    : COMP_LIBRARY;

  return (
    <div className="min-h-screen h-screen bg-[#0a0f1a] text-gray-100 flex flex-col font-mono overflow-hidden">

      {/* ═══ Menu Bar ═══ */}
      <div className="h-6 bg-[#0d1220] border-b border-[#1a2540] flex items-center px-2 text-[10px] text-gray-500 gap-0 flex-shrink-0">
        {['File', 'Edit', 'View', 'Place', 'Route', 'High Speed', 'Verification', 'Library', 'Tools', 'Help'].map(m => (
          <button key={m} className="px-2.5 py-0.5 hover:bg-[#1a2540] hover:text-gray-300 rounded transition-colors">{m}</button>
        ))}
        <div className="flex-1" />
        <span className="text-gray-700 text-[9px]">PCB Layout Editor v1.0</span>
      </div>

      {/* ═══ Toolbar ═══ */}
      <div className="h-8 bg-[#0d1220] border-b border-[#1a2540] flex items-center px-2 gap-0.5 flex-shrink-0">
        <Link href="/" className="p-1 rounded hover:bg-[#1a2540] text-gray-500 hover:text-white transition-colors mr-2">
          <ArrowLeft size={14} />
        </Link>
        <div className="w-px h-5 bg-[#1a2540] mx-1" />

        {/* Tool buttons */}
        {[
          { id: 'select', icon: MousePointer2, tip: 'Select (S)' },
          { id: 'move', icon: Move, tip: 'Move (M)' },
          { id: 'route', icon: Crosshair, tip: 'Route Trace (R)' },
          { id: 'measure', icon: Ruler, tip: 'Measure (D)' },
        ].map(tool => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={tool.tip}
            className={`p-1.5 rounded transition-colors ${activeTool === tool.id ? 'bg-red-900/40 text-red-400' : 'text-gray-600 hover:bg-[#1a2540] hover:text-gray-300'}`}
          >
            <tool.icon size={13} />
          </button>
        ))}

        <div className="w-px h-5 bg-[#1a2540] mx-1" />

        {/* Grid info */}
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600 ml-2">
          <Grid3X3 size={11} />
          <span>Grid: 1.27mm</span>
        </div>

        <div className="flex-1" />

        {/* Model & API */}
        <Link
          href="/admin"
          className="p-1 rounded hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors flex items-center gap-1.5 mr-2"
          title="Admin Panel"
        >
          <Settings size={13} />
          <span className="text-[10px] font-medium">Admin</span>
        </Link>
        <div className="ml-1">
          <ModelSelector apiKey={apiKeys[0] || ''} selectedModel={selectedModel} onModelChange={setSelectedModel} />
        </div>
      </div>

      {/* ═══ Main Area ═══ */}
      <main className="flex-1 flex overflow-hidden">

        {/* ─── Left Panel (Chat / Library) ─── */}
        <div 
          className="flex-shrink-0 bg-[#0d1220] flex flex-col relative z-10"
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* Drag Handle */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-1 hover:w-1.5 bg-[#1a2540]/60 hover:bg-red-500/50 cursor-col-resize z-50 transition-colors"
            onMouseDown={() => {
              isDraggingSidebar.current = true;
              document.body.style.cursor = 'col-resize';
            }}
          />
          {/* Tab switcher */}
          <div className="flex border-b border-[#1a2540] flex-shrink-0">
            <button onClick={() => setLeftPanel('chat')}
              className={`flex-1 py-1.5 text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-colors
                ${leftPanel === 'chat' ? 'text-red-400 border-b-2 border-red-500 bg-[#1a2540]/30' : 'text-gray-600 hover:text-gray-400'}`}>
              <MessageSquare size={11} /> AI Chat
            </button>
            <button onClick={() => setLeftPanel('library')}
              className={`flex-1 py-1.5 text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-colors
                ${leftPanel === 'library' ? 'text-red-400 border-b-2 border-red-500 bg-[#1a2540]/30' : 'text-gray-600 hover:text-gray-400'}`}>
              <Package size={11} /> Library
            </button>
          </div>

          {/* Chat or Library content */}
          {leftPanel === 'chat' ? (
            <div className="flex-1 overflow-hidden">
              <PCBChatBox apiKey={apiKeys[0] || ''} model={selectedModel} onUpdatePCB={handlePCBUpdate}
                currentStep={currentStep} totalSteps={totalSteps} 
                modelSelectorNode={<ModelSelector apiKey={apiKeys[0] || ''} selectedModel={selectedModel} onModelChange={setSelectedModel} variant="minimal" />}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* Search */}
              <div className="p-2 border-b border-[#1a2540]">
                <div className="flex items-center gap-1.5 bg-[#0a0f1a] border border-[#1a2540] rounded px-2 py-1">
                  <Search size={10} className="text-gray-600" />
                  <input value={libSearch} onChange={e => setLibSearch(e.target.value)}
                    placeholder="Search components..."
                    className="bg-transparent text-[10px] text-white outline-none flex-1 placeholder-gray-700" />
                </div>
              </div>
              {/* Categories */}
              {filteredLib.map(cat => (
                <div key={cat.cat}>
                  <button onClick={() => setExpandedCat(expandedCat === cat.cat ? null : cat.cat)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-400 hover:bg-[#1a2540] transition-colors">
                    <ChevronDown size={10} className={`transition-transform ${expandedCat === cat.cat ? '' : '-rotate-90'}`} />
                    <cat.icon size={11} />
                    <span className="font-semibold">{cat.cat}</span>
                    <span className="text-gray-700 ml-auto">{cat.items.length}</span>
                  </button>
                  {expandedCat === cat.cat && (
                    <div className="pb-1">
                      {cat.items.map(item => (
                        <div key={item}
                          className="px-6 py-1 text-[10px] text-gray-500 hover:bg-[#1a2540] hover:text-gray-300 cursor-pointer transition-colors flex items-center gap-2">
                          <div className="w-2 h-2 rounded-sm bg-[#44cc44] opacity-50" />
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Center: PCB Canvas ─── */}
        <div className="flex-1 relative overflow-hidden">
          <PCBCanvas
            data={pcbData} currentStep={currentStep} onStepChange={setCurrentStep}
            layers={layers} mousePos={mousePos} onMousePosChange={setMousePos}
          />
        </div>

        {/* ─── Right Panel (Layers + Properties) ─── */}
        <div className="w-[200px] flex-shrink-0 border-l border-[#1a2540] bg-[#0d1220] flex flex-col">
          {/* Layers section */}
          <div className="border-b border-[#1a2540]">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 flex items-center gap-1.5 border-b border-[#1a2540]">
              <Layers size={11} /> Layers
            </div>
            <div className="py-1">
              {LAYER_CONFIG.map(l => (
                <button key={l.key} onClick={() => toggleLayer(l.key)}
                  className="w-full flex items-center gap-2 px-3 py-1 hover:bg-[#1a2540] transition-colors group">
                  <div className="w-3 h-3 rounded-sm border" style={{
                    backgroundColor: layers[l.key as keyof typeof layers] ? l.color : 'transparent',
                    borderColor: l.color,
                    opacity: layers[l.key as keyof typeof layers] ? 1 : 0.3
                  }} />
                  <span className={`text-[10px] flex-1 text-left ${layers[l.key as keyof typeof layers] ? 'text-gray-300' : 'text-gray-700'}`}>
                    {l.label}
                  </span>
                  <span className="text-[9px] text-gray-700 opacity-0 group-hover:opacity-100">{l.shortcut}</span>
                  {layers[l.key as keyof typeof layers] ?
                    <Eye size={10} className="text-gray-600" /> :
                    <EyeOff size={10} className="text-gray-800" />}
                </button>
              ))}
            </div>
          </div>

          {/* Properties section */}
          <div className="border-b border-[#1a2540]">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 flex items-center gap-1.5 border-b border-[#1a2540]">
              <Box size={11} /> Properties
            </div>
            <div className="px-3 py-2 text-[10px] text-gray-600">
              {pcbData ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-gray-500">Board</span><span className="text-gray-300">{pcbData.board_name}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Size</span><span className="text-gray-300">{pcbData.board_width}×{pcbData.board_height}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Layers</span><span className="text-gray-300">{pcbData.layers}-Layer</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Steps</span><span className="text-gray-300">{totalSteps}</span></div>
                </div>
              ) : (
                <span className="text-gray-700">No board loaded</span>
              )}
            </div>
          </div>

          {/* Design Manager */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 flex items-center gap-1.5 border-b border-[#1a2540]">
              <CircuitBoard size={11} /> Design Manager
            </div>
            {pcbData && (
              <div className="py-1">
                {/* List all components placed so far */}
                {(() => {
                  const comps: any[] = [];
                  for (let i = 0; i <= currentStep && i < pcbData.steps.length; i++) {
                    pcbData.steps[i].add_components?.forEach((c: any) => comps.push(c));
                  }
                  return comps.map((c: any) => (
                    <div key={c.id} className="px-3 py-0.5 text-[10px] text-gray-600 hover:bg-[#1a2540] hover:text-gray-300 cursor-pointer transition-colors flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#44cc44]" />
                      <span className="text-gray-400 font-bold w-8">{c.id}</span>
                      <span className="truncate">{c.value || c.type}</span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ═══ Status Bar ═══ */}
      <div className="h-5 bg-[#0d1220] border-t border-[#1a2540] flex items-center px-3 text-[9px] text-gray-600 gap-4 flex-shrink-0 font-mono">
        <span>X: <span className="text-gray-400">{mousePos ? mousePos.x.toFixed(1) : '---'}</span></span>
        <span>Y: <span className="text-gray-400">{mousePos ? mousePos.y.toFixed(1) : '---'}</span></span>
        <div className="w-px h-3 bg-[#1a2540]" />
        <span>Grid: <span className="text-gray-400">1.27mm</span></span>
        <div className="w-px h-3 bg-[#1a2540]" />
        <span>Layer: <span className="text-red-400">Top</span></span>
        <div className="flex-1" />
        {pcbData && <span>Components: <span className="text-gray-400">{(() => { let c = 0; for (let i = 0; i <= currentStep && i < pcbData.steps.length; i++) c += pcbData.steps[i].add_components?.length || 0; return c; })()}</span></span>}
        {pcbData && <span>Nets: <span className="text-gray-400">{new Set((() => { const nets: string[] = []; for (let i = 0; i <= currentStep && i < pcbData.steps.length; i++) pcbData.steps[i].add_traces?.forEach((t: any) => nets.push(t.net)); return nets; })()).size}</span></span>}
      </div>
    </div>
  );
}
