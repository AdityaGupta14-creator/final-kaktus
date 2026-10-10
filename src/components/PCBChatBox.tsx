'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Cpu, Layers, CircuitBoard, Zap, ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { requestAgent } from '@/lib/agent/client';

interface PCBMessage {
  role: 'user' | 'assistant';
  content: string;
  parsedPCB?: any;
  sources?: Array<{ title: string; uri: string }>;
}

interface PCBChatBoxProps {
  apiKey: string;
  model: string;
  onUpdatePCB: (data: any) => void;
  currentStep?: number;
  totalSteps?: number;
  modelSelectorNode?: React.ReactNode;
}

export function PCBChatBox({ apiKey, model, onUpdatePCB, currentStep = 0, totalSteps = 0, modelSelectorNode }: PCBChatBoxProps) {
  const [messages, setMessages] = useState<PCBMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const parsePCBData = (text: string) => {
    const tutorialMatch = text.match(/<pcb_design>([\s\S]*?)<\/pcb_design>/);
    if (!tutorialMatch) return null;

    const raw = tutorialMatch[1].trim();
    try {
      return JSON.parse(raw);
    } catch {
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch {}
    }
    return null;
  };

  const getCleanText = (content: string) => {
    return content
      .replace(/<pcb_design>[\s\S]*?<\/pcb_design>/g, '')
      .replace(/<cmd>[\s\S]*?<\/cmd>/g, '')
      .trim();
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading || !apiKey || !model) return;

    const userMsg: PCBMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const transcript = [...messages, userMsg].slice(-8);
      const latestPCBDesignIndex = transcript.reduce((latestIndex, message, index) =>
        message.role === 'assistant' && message.parsedPCB ? index : latestIndex, -1);
      const conversationHistory = transcript.map((message, index) => {
        const text = message.role === 'assistant'
          ? index === latestPCBDesignIndex
            ? `${getCleanText(message.content)}\n<pcb_design>${JSON.stringify(message.parsedPCB)}</pcb_design>`
            : getCleanText(message.content).slice(0, 900)
          : message.content.slice(0, 1_600);
        return {
          role: message.role === 'user' ? 'user' : 'model',
          parts: [{ text }],
        };
      });
      while (conversationHistory[0]?.role === 'model') conversationHistory.shift();

      const systemPrompt = `You are an expert PCB (Printed Circuit Board) design engineer. When a user asks you to design a PCB, output a structured JSON inside <pcb_design></pcb_design> tags.

THINK LIKE A PCB ENGINEER:
1. Choose appropriate component packages (SMD vs through-hole)
2. Plan copper trace routing to minimize crossings
3. Consider signal integrity, power distribution, ground planes
4. Place decoupling capacitors near IC power pins
5. Route high-speed signals with proper impedance

PCB DESIGN JSON SCHEMA:
<pcb_design>
{"board_name":"Power Supply","description":"5V regulated power supply","board_width":800,"board_height":600,"layers":2,"steps":[
  {"phase":"substrate","instruction":"Prepare FR-4 substrate board","detail":"The FR-4 fiberglass-reinforced epoxy board provides mechanical strength and electrical insulation. Standard 1.6mm thickness with 1oz copper.","add_components":[],"add_traces":[],"add_vias":[]},
  {"phase":"components","instruction":"Place voltage regulator U1 (LM7805)","detail":"The LM7805 linear regulator converts input voltage (7-35V) to stable 5V output. TO-220 package for good heat dissipation.","add_components":[{"id":"U1","type":"ic","x":400,"y":300,"rotation":0,"value":"LM7805","package":"TO-220","pads":[{"id":"U1_1","x":385,"y":330,"width":15,"height":25,"shape":"rect","label":"IN","net":"VIN"},{"id":"U1_2","x":400,"y":330,"width":15,"height":25,"shape":"rect","label":"GND","net":"GND"},{"id":"U1_3","x":415,"y":330,"width":15,"height":25,"shape":"rect","label":"OUT","net":"5V"}]}]},
  {"phase":"components","instruction":"Place input capacitor C1","detail":"100µF electrolytic capacitor smooths input voltage ripple. Place as close to U1 input pin as possible.","add_components":[{"id":"C1","type":"capacitor","x":300,"y":300,"rotation":0,"value":"100µF","package":"Radial-8mm","pads":[{"id":"C1_1","x":295,"y":325,"width":12,"height":12,"shape":"circle","label":"+","net":"VIN"},{"id":"C1_2","x":305,"y":325,"width":12,"height":12,"shape":"circle","label":"-","net":"GND"}]}]},
  {"phase":"traces","instruction":"Route VIN trace from C1+ to U1 Input","detail":"Copper trace carries input voltage. Use wider trace (0.5mm) for power lines to handle current without excessive heating.","add_traces":[{"id":"T1","points":[{"x":295,"y":325},{"x":295,"y":350},{"x":385,"y":350},{"x":385,"y":330}],"width":3,"layer":"top","net":"VIN"}]},
  {"phase":"traces","instruction":"Route GND trace from C1- to U1 GND","detail":"Ground connection must be low impedance. Star-ground topology prevents ground loops.","add_traces":[{"id":"T2","points":[{"x":305,"y":325},{"x":305,"y":360},{"x":400,"y":360},{"x":400,"y":330}],"width":3,"layer":"top","net":"GND"}]},
  {"phase":"drilling","instruction":"Drill through-holes for C1","detail":"Drill 0.8mm holes for the capacitor leads. Clean burrs after drilling.","add_vias":[]},
  {"phase":"silkscreen","instruction":"Add component labels","detail":"White silkscreen markings help with assembly. Reference designators (R1, C1, U1) and polarity markers."},
  {"phase":"solder_mask","instruction":"Apply solder mask","detail":"Green solder mask protects copper traces from oxidation and prevents solder bridges. Openings left at pad locations."},
  {"phase":"testing","instruction":"Continuity test all nets","detail":"Use multimeter to verify: VIN net has continuity from input connector to U1 pin 1 and C1+. GND net connects U1 pin 2, C1-, and output connector GND.","add_components":[],"add_traces":[]}
]}
</pcb_design>

COMPONENT TYPES: resistor, capacitor, ic, led, diode, transistor, connector, inductor, crystal, fuse, relay, transformer, header, switch, potentiometer, voltage_regulator

PACKAGES: SMD-0402, SMD-0603, SMD-0805, SMD-1206, SOT-23, SOT-223, SOP-8, SOP-16, SSOP-20, QFP-32, QFP-44, QFP-64, QFN-32, BGA-256, DIP-8, DIP-14, DIP-16, DIP-28, TO-92, TO-220, TO-263, Radial-5mm, Radial-8mm, Axial

PAD SHAPES: rect (for SMD), circle (for through-hole), oval (for elongated)

RULES:
- ONE STEP AT A TIME: Each step adds exactly 1 component OR 1-2 traces. Never batch.
- COMPLETE DESIGN: Output the full PCB design from substrate to testing.
- REALISTIC PLACEMENT: Components must be placed with proper spacing. No overlapping.
- TRACE ROUTING: Route traces one at a time. Show exactly which pads are being connected and why.
- POWER INTEGRITY: Always include decoupling capacitors near IC power pins.
- Board coordinates: Use x: 50-750, y: 50-550 within the board area.
- Keep total steps under 35 to avoid JSON truncation.

CONVERSATIONAL RULES:
- Questions about PCB design → plain text answer, no tags
- "design a PCB for X" → output full <pcb_design> JSON
- "add a component" → output <pcb_design> with action:"UPDATE_CURRENT"
- Explain copper weight, trace width calculations, thermal relief etc. when relevant`;

      const response = await requestAgent({
        apiKeys: [apiKey], model, systemPrompt,
        contents: conversationHistory as Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
        temperature: 0.3, maxOutputTokens: 16384, research: true,
      });
      const text = response.text || 'No response';
      const pcbData = parsePCBData(text);
      const assistantMsg: PCBMessage = { role: 'assistant', content: text, parsedPCB: pcbData, sources: response.sources };
      setMessages(prev => [...prev, assistantMsg]);

      if (pcbData) {
        onUpdatePCB(pcbData);
      }
    } catch (err: any) {
      const errMsg: PCBMessage = { role: 'assistant', content: `Error: ${err.message}` };
      setMessages(prev => [...prev, errMsg]);
    }

    setIsLoading(false);
  }, [input, isLoading, apiKey, model, messages, onUpdatePCB]);

  const quickPrompts = [
    { label: '⚡ Power Supply', prompt: 'Design a 5V regulated power supply PCB with LM7805, input/output capacitors, LED indicator, and barrel jack connector' },
    { label: '🎛️ Arduino Shield', prompt: 'Design a simple Arduino shield PCB with 3 LEDs, 2 push buttons, and a buzzer' },
    { label: '🔊 Audio Amp', prompt: 'Design a small audio amplifier PCB using LM386 with volume control potentiometer' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#111]">
      {/* Header */}
      <div className="p-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2 mb-2">
          <CircuitBoard size={16} className="text-gray-200" />
          <span className="text-xs font-semibold text-gray-200">PCB Design AI</span>
        </div>
        {totalSteps > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><Layers size={10} /> {totalSteps} steps</span>
            <span className="flex items-center gap-1"><Cpu size={10} /> Step {currentStep + 1}</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <CircuitBoard size={40} className="mx-auto mb-3 text-emerald-500/30" />
            <p className="text-gray-500 text-xs mb-4">Describe your circuit and I'll design the PCB layout</p>
            <div className="space-y-2">
              {quickPrompts.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => setInput(qp.prompt)}
                  className="block w-full text-left px-3 py-2 rounded-lg bg-[#1a1a1a] border border-gray-800 text-xs text-gray-400 hover:text-gray-200 hover:border-emerald-800 transition-colors"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#2a2a2a] text-emerald-200 border border-emerald-700/30'
                : 'bg-[#1a1a1a] text-gray-300 border border-gray-800/50'
            }`}>
              {getCleanText(msg.content) && (
                <p className="whitespace-pre-wrap">{getCleanText(msg.content)}</p>
              )}
              {msg.sources && msg.sources.length > 0 && <div className="mt-2 space-y-1 border-t border-gray-800 pt-2">{msg.sources.slice(0, 6).map(source => <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="block text-[10px] text-blue-400 hover:underline">{source.title}</a>)}</div>}
              {msg.parsedPCB && (
                <div className="mt-2 p-2 rounded-lg bg-[#1e1e1e] border border-gray-700">
                  <div className="flex items-center gap-1.5 text-gray-200 font-medium mb-1">
                    <CircuitBoard size={12} />
                    PCB Design Generated
                  </div>
                  <div className="text-[10px] text-gray-500 space-y-0.5">
                    <div>📋 {msg.parsedPCB.steps?.length || 0} manufacturing steps</div>
                    <div>📐 {msg.parsedPCB.board_width}mm × {msg.parsedPCB.board_height}mm</div>
                    <div>🔲 {msg.parsedPCB.layers}-layer board</div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2 items-center text-gray-200 text-xs">
            <Loader2 size={14} className="animate-spin" />
            Designing PCB layout...
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800/60">
        {modelSelectorNode && <div className="mb-2">{modelSelectorNode}</div>}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Design a PCB for..."
            className="flex-1 bg-[#1a1a1a] border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 outline-none focus:border-emerald-600 transition-colors"
            disabled={isLoading || !apiKey}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !apiKey}
            className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
