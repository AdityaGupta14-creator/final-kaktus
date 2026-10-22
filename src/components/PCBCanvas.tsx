'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Play, Pause, RotateCcw, Minus, ChevronUp } from 'lucide-react';

// ─── Interfaces ───
export interface PCBPad {
  id: string; x: number; y: number; width: number; height: number;
  shape: 'rect' | 'circle' | 'oval'; drill?: number; label?: string; net?: string;
}
export interface PCBTrace {
  id: string; points: { x: number; y: number }[]; width: number;
  layer: 'top' | 'bottom'; net: string;
}
export interface PCBComponent {
  id: string; type: string; x: number; y: number; rotation: number;
  value?: string; package?: string; pads: PCBPad[]; silkscreen?: string;
}
export interface PCBVia {
  id: string; x: number; y: number; diameter: number; drill: number;
}
export interface PCBStep {
  instruction: string; detail: string;
  phase: string;
  add_components?: PCBComponent[]; add_traces?: PCBTrace[];
  add_vias?: PCBVia[]; add_pads?: PCBPad[];
}
export interface PCBData {
  board_name: string; description: string;
  board_width: number; board_height: number; layers: number;
  steps: PCBStep[];
}
export interface PCBCanvasProps {
  data: PCBData | null; currentStep: number; onStepChange: (step: number) => void;
  layers: Record<string, boolean>;
  mousePos: { x: number; y: number } | null;
  onMousePosChange: (pos: { x: number; y: number } | null) => void;
}

// ─── Layer color config (EDA standard) ───
const LAYER_COLORS = {
  top: '#ff3333',       // Red - Top copper
  bottom: '#3366ff',    // Blue - Bottom copper
  silk: '#ffff00',      // Yellow - Silkscreen
  mask: '#00aa44',      // Green - Solder mask
  pad: '#44cc44',       // Green - Pads
  drill: '#ffffff',     // White - Drill holes
  via: '#66ff66',       // Bright green - Vias
  ratsnest: '#444488',  // Dim blue - Unrouted
  board: '#1a1a2e',     // Dark navy - Board area
  bg: '#0a0f1a',        // Very dark - Background
};

// ─── Phase badge colors ───
const PHASE_COLORS: Record<string, string> = {
  substrate: 'bg-amber-900/60 text-amber-300 border-amber-700',
  copper: 'bg-orange-900/60 text-orange-300 border-orange-700',
  components: 'bg-blue-900/60 text-blue-300 border-blue-700',
  traces: 'bg-red-900/60 text-red-300 border-red-700',
  silkscreen: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  solder_mask: 'bg-green-900/60 text-green-300 border-green-700',
  drilling: 'bg-purple-900/60 text-purple-300 border-purple-700',
  testing: 'bg-cyan-900/60 text-cyan-300 border-cyan-700',
  ground_plane: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
};

// ─── Component Footprint Renderer (EDA style) ───
function RenderFootprint({ comp }: { comp: PCBComponent }) {
  const t = comp.type.toLowerCase();
  const pkg = (comp.package || '').toLowerCase();

  // QFP/TQFP IC
  if ((t === 'ic' || t === 'mcu' || t === 'microcontroller' || t === 'voltage_regulator') &&
      (pkg.includes('qfp') || pkg.includes('tqfp') || pkg.includes('lqfp'))) {
    const pinCount = parseInt(pkg.match(/\d+/)?.[0] || '32');
    const pps = Math.floor(pinCount / 4);
    const bs = Math.max(18, pps * 2.5);
    const h = bs / 2;
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        {/* Body */}
        <rect x={-h} y={-h} width={bs} height={bs} fill="#1a1a1a" stroke={LAYER_COLORS.silk} strokeWidth={0.4} opacity={0.9} />
        {/* Pin 1 marker */}
        <circle cx={-h + 2.5} cy={-h + 2.5} r={1.2} fill={LAYER_COLORS.silk} opacity={0.6} />
        {/* Thermal pad */}
        <rect x={-h * 0.4} y={-h * 0.4} width={h * 0.8} height={h * 0.8} fill={LAYER_COLORS.pad} opacity={0.15} />
        {/* Pins per side */}
        {Array.from({ length: pps }).map((_, i) => {
          const offset = -h + 2 + i * ((bs - 4) / Math.max(1, pps - 1));
          return (
            <React.Fragment key={i}>
              <rect x={offset - 0.5} y={-h - 3} width={1} height={3} fill={LAYER_COLORS.pad} />
              <rect x={offset - 0.5} y={h} width={1} height={3} fill={LAYER_COLORS.pad} />
              <rect x={-h - 3} y={offset - 0.5} width={3} height={1} fill={LAYER_COLORS.pad} />
              <rect x={h} y={offset - 0.5} width={3} height={1} fill={LAYER_COLORS.pad} />
            </React.Fragment>
          );
        })}
        <text x={0} y={2} fill={LAYER_COLORS.silk} fontSize={Math.min(4, bs / 5)} textAnchor="middle" fontFamily="monospace" opacity={0.8}>
          {comp.value || comp.id}
        </text>
      </g>
    );
  }

  // SOP/SOIC/SSOP
  if ((t === 'ic' || t === 'voltage_regulator') &&
      (pkg.includes('sop') || pkg.includes('soic') || pkg.includes('ssop'))) {
    const pinCount = parseInt(pkg.match(/\d+/)?.[0] || '8');
    const pps = Math.floor(pinCount / 2);
    const bw = Math.max(10, pps * 2.5);
    const bh = 6;
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} fill="#1a1a1a" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        <circle cx={-bw / 2 + 2} cy={0} r={0.8} fill={LAYER_COLORS.silk} opacity={0.6} />
        {Array.from({ length: pps }).map((_, i) => (
          <React.Fragment key={i}>
            <rect x={-bw / 2 + 1.5 + i * ((bw - 3) / Math.max(1, pps - 1))} y={-bh / 2 - 2.5} width={1} height={2.5} fill={LAYER_COLORS.pad} />
            <rect x={-bw / 2 + 1.5 + i * ((bw - 3) / Math.max(1, pps - 1))} y={bh / 2} width={1} height={2.5} fill={LAYER_COLORS.pad} />
          </React.Fragment>
        ))}
        <text x={0} y={1.5} fill={LAYER_COLORS.silk} fontSize={2.5} textAnchor="middle" fontFamily="monospace" opacity={0.7}>
          {comp.value || comp.id}
        </text>
      </g>
    );
  }

  // SOT-23 / SOT-223 / TO-220 / TO-92
  if (pkg.includes('sot') || pkg.includes('to-')) {
    const isTO220 = pkg.includes('to-220') || pkg.includes('to-263');
    const w = isTO220 ? 14 : 6;
    const h = isTO220 ? 10 : 5;
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#1a1a1a" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        {isTO220 && <rect x={-w / 2 + 1} y={-h / 2 - 2} width={w - 2} height={2.5} fill="#555" opacity={0.5} />}
        {[-2, 0, 2].map((px, i) => (
          <rect key={i} x={px - 0.4} y={h / 2} width={0.8} height={3} fill={LAYER_COLORS.pad} />
        ))}
        <text x={0} y={1} fill={LAYER_COLORS.silk} fontSize={2} textAnchor="middle" fontFamily="monospace" opacity={0.7}>
          {comp.value || comp.id}
        </text>
      </g>
    );
  }

  // DIP
  if (pkg.includes('dip')) {
    const pinCount = parseInt(pkg.match(/\d+/)?.[0] || '14');
    const pps = Math.floor(pinCount / 2);
    const bw = Math.max(12, pps * 3);
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-bw / 2} y={-5} width={bw} height={10} fill="#222" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        <path d={`M ${-bw / 2} -1 A 2 2 0 0 0 ${-bw / 2} 1`} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        {Array.from({ length: pps }).map((_, i) => (
          <React.Fragment key={i}>
            <circle cx={-bw / 2 + 2 + i * ((bw - 4) / Math.max(1, pps - 1))} cy={-7.5} r={1.3} fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
            <circle cx={-bw / 2 + 2 + i * ((bw - 4) / Math.max(1, pps - 1))} cy={7.5} r={1.3} fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
          </React.Fragment>
        ))}
        <text x={0} y={1.5} fill={LAYER_COLORS.silk} fontSize={2.5} textAnchor="middle" fontFamily="monospace" opacity={0.7}>
          {comp.value || comp.id}
        </text>
      </g>
    );
  }

  // SMD Resistor / Capacitor
  if (t === 'resistor' || t === 'capacitor') {
    const w = pkg.includes('1206') ? 5 : pkg.includes('0805') ? 3.5 : pkg.includes('0603') ? 2.5 : 3;
    const h = w * 0.5;
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} opacity={0.6} />
        <rect x={-w / 2} y={-h / 2} width={w * 0.3} height={h} fill={LAYER_COLORS.pad} opacity={0.8} />
        <rect x={w / 2 - w * 0.3} y={-h / 2} width={w * 0.3} height={h} fill={LAYER_COLORS.pad} opacity={0.8} />
      </g>
    );
  }

  // LED
  if (t === 'led') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-2.5} y={-1.5} width={5} height={3} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} />
        <polygon points="-0.5,-1 1,0 -0.5,1" fill={LAYER_COLORS.silk} opacity={0.4} />
        <rect x={-2.5} y={-1.5} width={1} height={3} fill={LAYER_COLORS.pad} opacity={0.8} />
        <rect x={1.5} y={-1.5} width={1} height={3} fill={LAYER_COLORS.pad} opacity={0.8} />
      </g>
    );
  }

  // Crystal
  if (t === 'crystal') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-3.5} y={-1.5} width={7} height={3} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} rx={1} />
        <rect x={-2} y={-1} width={4} height={2} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} />
        <rect x={-3.5} y={-0.8} width={1} height={1.6} fill={LAYER_COLORS.pad} />
        <rect x={2.5} y={-0.8} width={1} height={1.6} fill={LAYER_COLORS.pad} />
      </g>
    );
  }

  // Connector / Header
  if (t === 'connector' || t === 'header') {
    const pinStr = pkg?.match(/(\d+)x(\d+)/i) || pkg?.match(/(\d+)/);
    let rows = 1, cols = 4;
    if (pinStr && pinStr[2]) { rows = parseInt(pinStr[1]); cols = parseInt(pinStr[2]); }
    else if (pinStr) { cols = parseInt(pinStr[1]); }
    if (cols > 20) { rows = 2; cols = Math.ceil(cols / 2); }
    const w = cols * 3 + 2;
    const h = rows * 3 + 2;
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => (
            <circle key={`${r}-${c}`} cx={-w / 2 + 2.5 + c * 3} cy={-h / 2 + 2.5 + r * 3} r={1.2}
              fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
          ))
        )}
      </g>
    );
  }

  // Switch
  if (t === 'switch') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-5} y={-4} width={10} height={8} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        <circle cx={0} cy={0} r={2.5} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} />
        {[[-3, -3], [3, -3], [-3, 3], [3, 3]].map(([px, py], i) => (
          <circle key={i} cx={px} cy={py} r={1.2} fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
        ))}
      </g>
    );
  }

  // Diode
  if (t === 'diode') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-3} y={-1.2} width={6} height={2.4} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} />
        <line x1={2} y1={-1.2} x2={2} y2={1.2} stroke={LAYER_COLORS.silk} strokeWidth={0.6} />
        <rect x={-3} y={-1.2} width={1.2} height={2.4} fill={LAYER_COLORS.pad} />
        <rect x={1.8} y={-1.2} width={1.2} height={2.4} fill={LAYER_COLORS.pad} />
      </g>
    );
  }

  // Transistor
  if (t === 'transistor') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <rect x={-3} y={-2.5} width={6} height={5} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.3} />
        {[-2, 0, 2].map((px, i) => (
          <rect key={i} x={px - 0.5} y={2.5} width={1} height={2} fill={LAYER_COLORS.pad} />
        ))}
        <text x={0} y={0.5} fill={LAYER_COLORS.silk} fontSize={2} textAnchor="middle" fontFamily="monospace" opacity={0.6}>
          {comp.value || 'Q'}
        </text>
      </g>
    );
  }

  // Buzzer / generic round component
  if (t === 'buzzer') {
    return (
      <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
        <circle cx={0} cy={0} r={6} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
        <circle cx={0} cy={0} r={4} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.2} opacity={0.4} />
        <text x={0} y={-1} fill={LAYER_COLORS.silk} fontSize={2} textAnchor="middle" fontFamily="monospace" opacity={0.5}>+</text>
        <circle cx={-3} cy={0} r={1.2} fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
        <circle cx={3} cy={0} r={1.2} fill={LAYER_COLORS.pad} stroke="#1a5c1a" strokeWidth={0.3} />
      </g>
    );
  }

  // Fallback
  return (
    <g transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
      <rect x={-5} y={-3.5} width={10} height={7} fill="none" stroke={LAYER_COLORS.silk} strokeWidth={0.4} />
      <text x={0} y={1} fill={LAYER_COLORS.silk} fontSize={2.5} textAnchor="middle" fontFamily="monospace" opacity={0.6}>
        {comp.id}
      </text>
    </g>
  );
}

// ─── Main Canvas ───
export function PCBCanvas({ data, currentStep, onStepChange, layers, mousePos, onMousePosChange }: PCBCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(0.8);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [cursorGlowPos, setCursorGlowPos] = useState({ x: -1000, y: -1000 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [stepMinimized, setStepMinimized] = useState(false);

  // Auto-play through steps
  useEffect(() => {
    if (!isPlaying || !data) return;
    if (currentStep >= data.steps.length - 1) { setIsPlaying(false); return; }
    const timer = setTimeout(() => onStepChange(currentStep + 1), 1000);
    return () => clearTimeout(timer);
  }, [isPlaying, currentStep, data, onStepChange]);

  // Accumulate state up to currentStep
  const accumulated = useMemo(() => {
    if (!data) return { components: [] as PCBComponent[], traces: [] as PCBTrace[], vias: [] as PCBVia[], pads: [] as PCBPad[], newTraceIds: new Set<string>(), newCompIds: new Set<string>() };
    const compMap = new Map<string, PCBComponent>();
    const traceMap = new Map<string, PCBTrace>();
    const viaMap = new Map<string, PCBVia>();
    const padMap = new Map<string, PCBPad>();
    const newTraceIds = new Set<string>();
    const newCompIds = new Set<string>();

    for (let i = 0; i <= currentStep && i < data.steps.length; i++) {
      const step = data.steps[i];
      step.add_components?.forEach(c => { compMap.set(c.id, c); if (i === currentStep) newCompIds.add(c.id); });
      step.add_traces?.forEach(tr => { traceMap.set(tr.id, tr); if (i === currentStep) newTraceIds.add(tr.id); });
      step.add_vias?.forEach(v => viaMap.set(v.id, v));
      step.add_pads?.forEach(p => padMap.set(p.id, p));
    }
    return {
      components: Array.from(compMap.values()),
      traces: Array.from(traceMap.values()),
      vias: Array.from(viaMap.values()),
      pads: Array.from(padMap.values()),
      newTraceIds, newCompIds
    };
  }, [data, currentStep]);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const positionRef = useRef(position);
  positionRef.current = position;

  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchStateRef = useRef<{
    initialDist: number;
    initialScale: number;
    initialMidpoint: { x: number; y: number };
    initialPosition: { x: number; y: number };
  } | null>(null);
  const panStartRef = useRef<{ clientX: number; clientY: number; posAtStart: { x: number; y: number } } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const zoomAtPoint = useCallback((targetScale: number, fx: number, fy: number) => {
    setScale(prevScale => {
      const clampedScale = Math.min(5, Math.max(0.15, targetScale));
      setPosition(prevPos => {
        const wx = (fx - prevPos.x) / prevScale;
        const wy = (fy - prevPos.y) / prevScale;
        return {
          x: fx - wx * clampedScale,
          y: fy - wy * clampedScale,
        };
      });
      return clampedScale;
    });
  }, []);

  const zoomCentered = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    zoomAtPoint(scaleRef.current + delta, cx, cy);
  }, [zoomAtPoint]);

  const handlePointerDown = (e: React.PointerEvent) => {
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    // Multi-touch pinch zoom (2 fingers)
    if (activePointersRef.current.size === 2) {
      panStartRef.current = null;
      setIsPanning(false);

      const pointers = Array.from(activePointersRef.current.values());
      const p1 = pointers[0];
      const p2 = pointers[1];
      const dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      const midX = (p1.clientX + p2.clientX) / 2;
      const midY = (p1.clientY + p2.clientY) / 2;

      pinchStateRef.current = {
        initialDist: Math.max(dist, 1),
        initialScale: scaleRef.current,
        initialMidpoint: { x: midX, y: midY },
        initialPosition: { ...positionRef.current },
      };
      return;
    }

    if (activePointersRef.current.size === 1) {
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        posAtStart: { ...positionRef.current },
      };
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}

      // Double-tap zoom on touchscreen
      if (e.pointerType === 'touch') {
        const now = Date.now();
        const last = lastTapRef.current;
        if (last && now - last.time < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const fx = e.clientX - rect.left;
            const fy = e.clientY - rect.top;
            if (scaleRef.current > 1.2) {
              setScale(0.8);
              setPosition({ x: 0, y: 0 });
            } else {
              zoomAtPoint(Math.min(5, scaleRef.current * 1.6), fx, fy);
            }
          }
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCursorGlowPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    }

    // 2-finger pinch gesture
    if (activePointersRef.current.size === 2 && pinchStateRef.current && containerRef.current) {
      const pointers = Array.from(activePointersRef.current.values());
      const p1 = pointers[0];
      const p2 = pointers[1];
      const currentDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      const currentMidX = (p1.clientX + p2.clientX) / 2;
      const currentMidY = (p1.clientY + p2.clientY) / 2;

      const { initialDist, initialScale, initialMidpoint, initialPosition } = pinchStateRef.current;
      const scaleFactor = currentDist / initialDist;
      const newScale = Math.min(5, Math.max(0.15, initialScale * scaleFactor));

      const rect = containerRef.current.getBoundingClientRect();
      const fx = initialMidpoint.x - rect.left;
      const fy = initialMidpoint.y - rect.top;

      const wx = (fx - initialPosition.x) / initialScale;
      const wy = (fy - initialPosition.y) / initialScale;

      const deltaX = currentMidX - initialMidpoint.x;
      const deltaY = currentMidY - initialMidpoint.y;

      const newX = (fx + deltaX) - wx * newScale;
      const newY = (fy + deltaY) - wy * newScale;

      setScale(newScale);
      setPosition({ x: newX, y: newY });
      return;
    }

    // Single-pointer pan
    if (panStartRef.current && isPanning) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setPosition({
        x: panStartRef.current.posAtStart.x + dx,
        y: panStartRef.current.posAtStart.y + dy,
      });
      return;
    }

    if (!svgRef.current || !data) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * (data.board_width + 40) - 20;
    const svgY = ((e.clientY - rect.top) / rect.height) * (data.board_height + 40) - 20;
    onMousePosChange({ x: Math.round(svgX * 10) / 10, y: Math.round(svgY * 10) / 10 });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    if (activePointersRef.current.size === 1) {
      const remaining = Array.from(activePointersRef.current.values())[0];
      panStartRef.current = {
        clientX: remaining.clientX,
        clientY: remaining.clientY,
        posAtStart: { ...positionRef.current },
      };
      setIsPanning(true);
    } else if (activePointersRef.current.size === 0) {
      panStartRef.current = null;
      setIsPanning(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      zoomAtPoint(scaleRef.current + delta, fx, fy);
    };

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    el.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleNativeWheel);
      el.removeEventListener('touchmove', handleNativeTouchMove);
    };
  }, [zoomAtPoint]);

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: LAYER_COLORS.bg }}>
        <div className="text-center opacity-40">
          <svg width="80" height="80" viewBox="0 0 80 80" className="mx-auto mb-3">
            <rect x="10" y="10" width="60" height="60" rx="4" fill="none" stroke={LAYER_COLORS.top} strokeWidth="1" strokeDasharray="4 3" />
            <circle cx="20" cy="20" r="3" fill={LAYER_COLORS.pad} opacity="0.5" />
            <circle cx="60" cy="20" r="3" fill={LAYER_COLORS.pad} opacity="0.5" />
            <circle cx="20" cy="60" r="3" fill={LAYER_COLORS.pad} opacity="0.5" />
            <circle cx="60" cy="60" r="3" fill={LAYER_COLORS.pad} opacity="0.5" />
            <line x1="20" y1="20" x2="60" y2="20" stroke={LAYER_COLORS.top} strokeWidth="1" opacity="0.3" />
            <line x1="20" y1="60" x2="60" y2="60" stroke={LAYER_COLORS.bottom} strokeWidth="1" opacity="0.3" />
          </svg>
          <p className="text-gray-600 text-xs font-mono">PCB LAYOUT EDITOR</p>
          <p className="text-gray-700 text-[10px] mt-1">Describe a circuit in the chat panel</p>
        </div>
      </div>
    );
  }

  const bw = data.board_width;
  const bh = data.board_height;
  const currentStepData = data.steps[currentStep];

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden select-none" style={{ background: LAYER_COLORS.bg }}>
      {/* Auto-play status */}
      <AnimatePresence>
        {isPlaying && currentStepData && (
          <motion.div
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-30 bg-black/85 backdrop-blur border border-red-900/50 rounded-lg px-4 py-1.5 flex items-center gap-2"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-300 text-[10px] font-mono uppercase tracking-wider">
              {currentStepData.phase === 'traces' ? 'Routing...' :
               currentStepData.phase === 'components' ? 'Placing...' :
               currentStepData.phase === 'drilling' ? 'Drilling...' :
               currentStepData.phase}
            </span>
            <span className="text-gray-600 text-[10px] font-mono">{currentStep + 1}/{data.steps.length}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 cursor-crosshair relative overflow-hidden touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => { onMousePosChange(null); }}
      >
        {/* Mouse Hover Glow Effect */}
        <div 
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background: `radial-gradient(400px circle at ${cursorGlowPos.x}px ${cursorGlowPos.y}px, rgba(255,255,255,0.06), transparent 40%)`
          }}
        />
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
        >
          <svg
            ref={svgRef}
            width={bw + 40}
            height={bh + 40}
            viewBox={`-20 -20 ${bw + 40} ${bh + 40}`}
          >
            <defs>
              {/* Minor grid (1mm) */}
              <pattern id="pcb-grid-minor" patternUnits="userSpaceOnUse" width="10" height="10">
                <circle cx="5" cy="5" r="0.2" fill="#1a2240" />
              </pattern>
              {/* Major grid (5mm) */}
              <pattern id="pcb-grid-major" patternUnits="userSpaceOnUse" width="50" height="50">
                <rect width="50" height="50" fill="url(#pcb-grid-minor)" />
                <circle cx="0" cy="0" r="0.4" fill="#253060" />
                <circle cx="50" cy="0" r="0.4" fill="#253060" />
                <circle cx="0" cy="50" r="0.4" fill="#253060" />
                <circle cx="50" cy="50" r="0.4" fill="#253060" />
              </pattern>
              {/* Trace glow filter */}
              <filter id="trace-glow-f">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Background grid */}
            <rect x={-20} y={-20} width={bw + 40} height={bh + 40} fill="url(#pcb-grid-major)" />

            {/* Board outline */}
            <rect x={0} y={0} width={bw} height={bh} rx={2}
              fill={LAYER_COLORS.board} stroke="#445588" strokeWidth={1} />

            {/* Board grid overlay */}
            <rect x={0} y={0} width={bw} height={bh} fill="url(#pcb-grid-major)" rx={2} />

            {/* Solder mask tint */}
            {layers.solderMask && (
              <rect x={0} y={0} width={bw} height={bh} rx={2} fill={LAYER_COLORS.mask} opacity={0.06} />
            )}

            {/* Mounting holes */}
            {[{ x: 6, y: 6 }, { x: bw - 6, y: 6 }, { x: 6, y: bh - 6 }, { x: bw - 6, y: bh - 6 }].map((mh, i) => (
              <g key={`mh-${i}`}>
                <circle cx={mh.x} cy={mh.y} r={3} fill={LAYER_COLORS.pad} opacity={0.3} />
                <circle cx={mh.x} cy={mh.y} r={1.5} fill={LAYER_COLORS.bg} />
              </g>
            ))}

            {/* Bottom copper traces */}
            {layers.bottomCopper && accumulated.traces.filter(t => t.layer === 'bottom').map(trace => {
              const d = trace.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const isNew = accumulated.newTraceIds.has(trace.id);
              return (
                <path key={trace.id} d={d} fill="none" stroke={LAYER_COLORS.bottom}
                  strokeWidth={trace.width} strokeLinecap="round" strokeLinejoin="round"
                  opacity={0.7}
                  filter={isNew ? 'url(#trace-glow-f)' : undefined}
                  style={isNew ? { strokeDasharray: 600, strokeDashoffset: 600, animation: 'pcb-trace-draw 0.8s ease-out forwards' } : undefined}
                />
              );
            })}

            {/* Top copper traces */}
            {layers.topCopper && accumulated.traces.filter(t => t.layer === 'top').map(trace => {
              const d = trace.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              const isNew = accumulated.newTraceIds.has(trace.id);
              return (
                <path key={trace.id} d={d} fill="none" stroke={LAYER_COLORS.top}
                  strokeWidth={trace.width} strokeLinecap="round" strokeLinejoin="round"
                  opacity={0.85}
                  filter={isNew ? 'url(#trace-glow-f)' : undefined}
                  style={isNew ? { strokeDasharray: 600, strokeDashoffset: 600, animation: 'pcb-trace-draw 0.8s ease-out forwards' } : undefined}
                />
              );
            })}

            {/* Vias */}
            {layers.drill && accumulated.vias.map(via => (
              <g key={via.id}>
                <circle cx={via.x} cy={via.y} r={via.diameter / 2} fill={LAYER_COLORS.via} opacity={0.5} />
                <circle cx={via.x} cy={via.y} r={via.diameter / 2} fill="none" stroke={LAYER_COLORS.via} strokeWidth={0.5} />
                <circle cx={via.x} cy={via.y} r={via.drill / 2} fill={LAYER_COLORS.bg} />
              </g>
            ))}

            {/* Standalone pads */}
            {accumulated.pads.map(pad => (
              <g key={pad.id}>
                {pad.shape === 'circle' ? (
                  <>
                    <circle cx={pad.x} cy={pad.y} r={pad.width / 2} fill={LAYER_COLORS.pad} opacity={0.7} />
                    {pad.drill && layers.drill && <circle cx={pad.x} cy={pad.y} r={pad.drill / 2} fill={LAYER_COLORS.bg} />}
                  </>
                ) : (
                  <rect x={pad.x - pad.width / 2} y={pad.y - pad.height / 2} width={pad.width} height={pad.height}
                    fill={LAYER_COLORS.pad} opacity={0.7} rx={0.3} />
                )}
              </g>
            ))}

            {/* Components - Footprints */}
            {accumulated.components.map(comp => {
              const isNew = accumulated.newCompIds.has(comp.id);
              const inner = (
                <>
                  <RenderFootprint comp={comp} />
                  {/* Render component pads */}
                  {comp.pads?.map(pad => (
                    <g key={pad.id}>
                      {pad.shape === 'circle' ? (
                        <>
                          <circle cx={pad.x} cy={pad.y} r={pad.width / 2} fill={LAYER_COLORS.pad} opacity={0.7}
                            stroke="#1a5c1a" strokeWidth={0.3} />
                          {pad.drill && layers.drill && <circle cx={pad.x} cy={pad.y} r={pad.drill / 2} fill={LAYER_COLORS.bg} />}
                        </>
                      ) : (
                        <rect x={pad.x - pad.width / 2} y={pad.y - pad.height / 2} width={pad.width} height={pad.height}
                          fill={LAYER_COLORS.pad} opacity={0.7} rx={0.2} />
                      )}
                    </g>
                  ))}
                </>
              );
              return isNew ? (
                <motion.g key={comp.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                  {inner}
                </motion.g>
              ) : (
                <g key={comp.id}>{inner}</g>
              );
            })}

            {/* Silkscreen labels */}
            {layers.silkscreen && accumulated.components.map(comp => (
              <text key={`ref-${comp.id}`}
                x={comp.x}
                y={comp.y - ((comp.type === 'resistor' || comp.type === 'capacitor' || comp.type === 'led' || comp.type === 'diode') ? 4 : 14)}
                fill={LAYER_COLORS.silk} fontSize={2.5} textAnchor="middle" fontFamily="monospace" opacity={0.5}
              >
                {comp.id}
              </text>
            ))}

            {/* Board title */}
            {layers.silkscreen && (
              <text x={bw / 2} y={bh - 5} fill={LAYER_COLORS.silk} fontSize={3.5}
                textAnchor="middle" fontFamily="monospace" opacity={0.25}>
                {data.board_name}
              </text>
            )}

            {/* Mouse crosshair */}
            {mousePos && mousePos.x >= 0 && mousePos.x <= bw && mousePos.y >= 0 && mousePos.y <= bh && (
              <g opacity={0.3}>
                <line x1={mousePos.x} y1={-20} x2={mousePos.x} y2={bh + 20} stroke="#446688" strokeWidth={0.3} strokeDasharray="2 2" />
                <line x1={-20} y1={mousePos.y} x2={bw + 20} y2={mousePos.y} stroke="#446688" strokeWidth={0.3} strokeDasharray="2 2" />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Bottom Controls */}
      {currentStepData && (
        <div className="absolute bottom-2 right-2 z-20 w-72 bg-[#0d1220]/95 backdrop-blur border border-[#1a2540] rounded-lg overflow-hidden text-[10px] shadow-2xl">
          <div className="px-3 py-2 border-b border-[#1a2540] flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-wider ${PHASE_COLORS[currentStepData.phase] || 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                  {currentStepData.phase}
                </span>
              </div>
              <p className="text-gray-200 font-medium text-[11px] truncate">{currentStepData.instruction}</p>
              {!stepMinimized && (
                <p className="text-gray-500 leading-relaxed line-clamp-2 mt-0.5">{currentStepData.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStepMinimized(m => !m)}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a2540] transition-colors shrink-0"
              title={stepMinimized ? "Expand step info" : "Minimize step info"}
            >
              {stepMinimized ? <ChevronUp size={12} /> : <Minus size={12} />}
            </button>
          </div>
          <div className="px-3 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button onClick={() => { setIsPlaying(p => !p); if (!isPlaying && currentStep >= (data?.steps.length || 1) - 1) onStepChange(0); }}
                className="p-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors">
                {isPlaying ? <Pause size={10} /> : <Play size={10} />}
              </button>
              <button onClick={() => { onStepChange(0); setIsPlaying(false); }}
                className="p-1 rounded bg-[#1a2540] text-gray-400 hover:text-white transition-colors">
                <RotateCcw size={10} />
              </button>
            </div>
            <span className="text-gray-500 font-mono">{currentStep + 1}/{data.steps.length}</span>
            <div className="flex gap-1">
              <button onClick={() => onStepChange(Math.max(0, currentStep - 1))} disabled={currentStep === 0}
                className="p-1 rounded bg-[#1a2540] text-white hover:bg-[#253060] disabled:opacity-20 transition-colors">
                <ChevronLeft size={12} />
              </button>
              <button onClick={() => onStepChange(Math.min(data.steps.length - 1, currentStep + 1))}
                disabled={currentStep === data.steps.length - 1}
                className="p-1 rounded bg-red-700 text-white hover:bg-red-600 disabled:opacity-20 transition-colors">
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom controls (Touch, Tablet & Desktop Optimized) */}
      <div 
        className="absolute bottom-3 left-3 z-20 flex items-center gap-1 bg-[#0d1220]/90 backdrop-blur-md border border-[#1a2540] rounded-xl p-1 shadow-2xl select-none"
        style={{ touchAction: 'manipulation' }}
      >
        <button 
          type="button"
          onClick={() => zoomCentered(0.25)}
          className="h-9 w-9 flex items-center justify-center rounded-lg bg-transparent text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 active:bg-white/20 transition-all cursor-pointer"
          title="Zoom In (Tap, Scroll or Pinch)"
          aria-label="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <div className="w-px h-5 bg-[#1a2540]"></div>
        <button 
          type="button"
          onClick={() => { setScale(0.8); setPosition({ x: 0, y: 0 }); }}
          className="h-9 px-2 flex items-center justify-center gap-1 rounded-lg bg-transparent text-[11px] font-mono font-semibold text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 active:bg-white/20 transition-all cursor-pointer"
          title="Reset View (Double-tap canvas or click here)"
          aria-label="Reset View"
        >
          <Maximize size={13} />
          <span>{Math.round(scale * 100)}%</span>
        </button>
        <div className="w-px h-5 bg-[#1a2540]"></div>
        <button 
          type="button"
          onClick={() => zoomCentered(-0.25)}
          className="h-9 w-9 flex items-center justify-center rounded-lg bg-transparent text-gray-300 hover:text-white hover:bg-white/10 active:scale-95 active:bg-white/20 transition-all cursor-pointer"
          title="Zoom Out (Tap, Scroll or Pinch)"
          aria-label="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
      </div>

      {/* Trace animation CSS */}
      <style jsx global>{`
        @keyframes pcb-trace-draw { to { stroke-dashoffset: 0; } }
      `}</style>
    </div>
  );
}
