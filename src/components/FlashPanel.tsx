'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Usb, Cpu, Upload, Check, AlertTriangle, Loader2, X,
  RefreshCw, Play, Terminal, Zap, Plug, ChevronDown,
  MonitorSpeaker, Square, WifiOff
} from 'lucide-react';

interface DetectedPort {
  port: string;
  description: string;
  vid_pid: string | null;
  manufacturer: string | null;
  board: string | null;
  fqbn: string | null;
}

interface FlashPanelProps {
  code: string;
  onClose: () => void;
}

type FlashStage = 'idle' | 'detecting' | 'compiling' | 'uploading' | 'success' | 'error' | 'monitoring';

const BOARD_OPTIONS = [
  { fqbn: 'arduino:avr:uno', name: 'Arduino Uno', icon: '' },
  { fqbn: 'arduino:avr:nano', name: 'Arduino Nano', icon: '' },
  { fqbn: 'arduino:avr:mega', name: 'Arduino Mega', icon: '' },
  { fqbn: 'esp32:esp32:esp32', name: 'ESP32 Dev Module', icon: '' },
  { fqbn: 'esp32:esp32:esp32s3', name: 'ESP32-S3', icon: '' },
  { fqbn: 'esp32:esp32:esp32c3', name: 'ESP32-C3', icon: '' },
];

export function FlashPanel({ code, onClose }: FlashPanelProps) {
  const [stage, setStage] = useState<FlashStage>('idle');
  const [ports, setPorts] = useState<DetectedPort[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Connect your board via USB');
  const [errorText, setErrorText] = useState('');
  const [compileOutput, setCompileOutput] = useState('');
  const [serialLines, setSerialLines] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [showBoardDropdown, setShowBoardDropdown] = useState(false);
  const [binarySize, setBinarySize] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const serialRef = useRef<EventSource | null>(null);
  const serialContainerRef = useRef<HTMLDivElement>(null);

  const API = 'http://localhost:8000';

  // Auto-detect boards on mount
  useEffect(() => {
    detectBoards();
  }, []);

  // Auto-scroll serial monitor if enabled
  useEffect(() => {
    if (autoScroll && serialContainerRef.current) {
      const container = serialContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [serialLines, autoScroll]);

  const detectBoards = useCallback(async () => {
    setStage('detecting');
    setStatusText('Scanning USB ports...');
    setProgress(20);
    
    try {
      const res = await fetch(`${API}/flash/boards`);
      const data = await res.json();
      setPorts(data.ports || []);
      
      // Auto-select first detected board
      const withBoard = (data.ports || []).find((p: DetectedPort) => p.board);
      if (withBoard) {
        setSelectedPort(withBoard.port);
        setSelectedBoard(withBoard.fqbn);
        setStatusText(`✓ ${withBoard.board} detected on ${withBoard.port}`);
      } else if (data.ports?.length > 0) {
        setSelectedPort(data.ports[0].port);
        setStatusText(`Found ${data.ports.length} port(s) — select your board type`);
      } else {
        setStatusText('No devices found. Connect your board via USB.');
      }
      setProgress(0);
      setStage('idle');
    } catch (e) {
      setStage('error');
      setErrorText('Kaktus local hardware connection service is unavailable. Start or restart the app connection service, then refresh ports and flash here. Your sketch stays in Kaktus; no external IDE is needed.');
    }
  }, []);

  const handleCompileAndFlash = useCallback(async () => {
    if (!selectedPort || !selectedBoard) {
      setErrorText('Please select a port and board first');
      setStage('error');
      return;
    }

    // Stage 1: Compile
    setStage('compiling');
    setStatusText('Compiling your code...');
    setProgress(30);
    setErrorText('');
    setCompileOutput('');

    try {
      const compileRes = await fetch(`${API}/flash/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, board: selectedBoard }),
      });
      const compileData = await compileRes.json();

      if (compileData.status === 'error') {
        // Check for missing libraries
        if (compileData.missing_libraries?.length > 0) {
          setStatusText(`Installing missing libraries: ${compileData.missing_libraries.join(', ')}...`);
          setProgress(40);
          
          for (const lib of compileData.missing_libraries) {
            await fetch(`${API}/flash/install-library`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ library: lib }),
            });
          }
          
          // Retry compilation
          setStatusText('Retrying compilation...');
          setProgress(50);
          const retryRes = await fetch(`${API}/flash/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, board: selectedBoard }),
          });
          const retryData = await retryRes.json();
          
          if (retryData.status === 'error') {
            setStage('error');
            setErrorText(retryData.error);
            setCompileOutput(retryData.stdout || '');
            return;
          }
          setBinarySize(retryData.binary_size || 0);
        } else {
          setStage('error');
          setErrorText(compileData.error);
          setCompileOutput(compileData.stdout || '');
          return;
        }
      } else {
        setBinarySize(compileData.binary_size || 0);
      }

      // Stage 2: Upload
      setStage('uploading');
      setStatusText(`Uploading to ${selectedPort}...`);
      setProgress(70);

      const uploadRes = await fetch(`${API}/flash/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, board: selectedBoard, port: selectedPort }),
      });
      const uploadData = await uploadRes.json();

      if (uploadData.status === 'error') {
        setStage('error');
        setErrorText(uploadData.error);
        return;
      }

      // Success!
      setStage('success');
      setStatusText('Code uploaded successfully! Your board is running.');
      setProgress(100);
      setCompileOutput(uploadData.stdout || '');

    } catch (e: any) {
      setStage('error');
      setErrorText(e.message || 'Unknown error occurred');
    }
  }, [code, selectedPort, selectedBoard]);

  const startSerialMonitor = useCallback(() => {
    if (!selectedPort) return;
    setIsMonitoring(true);
    setSerialLines([]);
    setStage('monitoring');
    

    // Auto-detect baud rate from code, default to 115200 for ESP32 or 9600 for others
    const baudMatch = code.match(/Serial\.begin\(\s*(\d+)\s*\)/);
    const baudRate = baudMatch ? baudMatch[1] : (selectedBoard.includes('esp32') ? '115200' : '9600');
    setStatusText(`Serial Monitor — ${selectedPort} @ ${baudRate} baud`);
    const eventSource = new EventSource(`${API}/flash/serial-monitor?port=${encodeURIComponent(selectedPort)}&baud=${baudRate}`);
    serialRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.line) {
          setSerialLines(prev => [...prev.slice(-200), data.line]);
        }
        if (data.error) {
          setSerialLines(prev => [...prev, `[ERROR] ${data.error}`]);
          stopSerialMonitor();
        }
      } catch {}
    };

    eventSource.onerror = () => {
      stopSerialMonitor();
    };
  }, [selectedPort]);

  const stopSerialMonitor = useCallback(() => {
    if (serialRef.current) {
      serialRef.current.close();
      serialRef.current = null;
    }
    setIsMonitoring(false);
    setStage('idle');
    setStatusText('Serial monitor stopped');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (serialRef.current) serialRef.current.close();
    };
  }, []);

  const stageColor = {
    idle: 'text-gray-400',
    detecting: 'text-gray-300',
    compiling: 'text-gray-300',
    uploading: 'text-gray-200',
    success: 'text-white',
    error: 'text-gray-400',
    monitoring: 'text-white',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-[#222222] shadow-2xl"
      style={{ height: stage === 'monitoring' ? '55vh' : '280px' }}
    >
      {/* Header */}
      <div className="h-9 border-b border-[#222222] bg-[#141414] flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-white" />
          <span className="text-xs font-bold text-gray-200">1-Click Flash</span>
          <span className={`text-[10px] font-mono ${stageColor[stage]}`}>
            {stage === 'compiling' && '● COMPILING'}
            {stage === 'uploading' && '● UPLOADING'}
            {stage === 'success' && '● DONE'}
            {stage === 'error' && '● ERROR'}
            {stage === 'monitoring' && '● SERIAL MONITOR'}
            {stage === 'detecting' && '● SCANNING...'}
            {stage === 'idle' && '○ READY'}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800">
          <X size={14} />
        </button>
      </div>

      <div className="flex h-[calc(100%-36px)]">
        {/* Left: Controls */}
        <div className="w-[320px] border-r border-[#222222] p-3 flex flex-col gap-3">
          {/* Board & Port Selection */}
          <div className="flex gap-2">
            {/* Port */}
            <div className="flex-1">
              <label className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 block">Port</label>
              <div className="flex items-center gap-1">
                <select
                  value={selectedPort}
                  onChange={e => setSelectedPort(e.target.value)}
                  className="flex-1 bg-[#0a0a0a] border border-[#333333] rounded px-2 py-1.5 text-xs text-white outline-none focus:border-white"
                >
                  <option value="">Select port...</option>
                  {ports.map(p => (
                    <option key={p.port} value={p.port}>
                      {p.port} {p.board ? `(${p.board})` : `- ${p.description}`}
                    </option>
                  ))}
                </select>
                <button onClick={detectBoards} title="Refresh ports"
                  className="p-1.5 rounded bg-[#1a1a1a] border border-[#333333] text-gray-400 hover:text-white hover:border-white transition-colors">
                  <RefreshCw size={12} className={stage === 'detecting' ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          </div>

          {/* Board Type */}
          <div>
            <label className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 block">Board</label>
            <div className="relative">
              <button
                onClick={() => setShowBoardDropdown(!showBoardDropdown)}
                className="w-full bg-[#0a0a0a] border border-[#333333] rounded px-2 py-1.5 text-xs text-left text-white flex items-center justify-between hover:border-white transition-colors"
              >
                <span>{BOARD_OPTIONS.find(b => b.fqbn === selectedBoard)?.name || 'Select board...'}</span>
                <ChevronDown size={12} className="text-gray-500" />
              </button>
              <AnimatePresence>
                {showBoardDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#141414] border border-[#333333] rounded-lg overflow-hidden shadow-xl"
                  >
                    {BOARD_OPTIONS.map(b => (
                      <button key={b.fqbn} onClick={() => { setSelectedBoard(b.fqbn); setShowBoardDropdown(false); }}
                        className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 hover:bg-[#1a1a1a] transition-colors
                          ${selectedBoard === b.fqbn ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'}`}>
                        <span>{b.icon}</span> {b.name}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Flash Buttons */}
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleCompileAndFlash}
              disabled={!selectedPort || !selectedBoard || stage === 'compiling' || stage === 'uploading'}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all
                bg-white hover:bg-gray-200
                text-black shadow-lg
                disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              {stage === 'compiling' || stage === 'uploading' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : stage === 'success' ? (
                <Check size={14} />
              ) : (
                <Upload size={14} />
              )}
              {stage === 'compiling' ? 'Compiling...' :
               stage === 'uploading' ? 'Uploading...' :
               stage === 'success' ? 'Flash Again' : 'Flash'}
            </button>
            
            <button
              onClick={isMonitoring ? stopSerialMonitor : startSerialMonitor}
              disabled={!selectedPort}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border
                ${isMonitoring 
                  ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700' 
                  : 'bg-[#1a1a1a] border-gray-800 text-gray-400 hover:border-gray-500 hover:text-white'}
                disabled:opacity-30 disabled:cursor-not-allowed`}
              title="Serial Monitor"
            >
              {isMonitoring ? <Square size={14} /> : <Terminal size={14} />}
            </button>
          </div>

          {/* Progress Bar */}
          {(stage === 'compiling' || stage === 'uploading') && (
            <div className="w-full bg-[#1a1a1a] rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          )}

          {/* Status Text */}
          <div className={`text-[10px] font-mono ${stageColor[stage]}`}>
            {stage === 'success' && binarySize > 0 && (
              <span className="text-gray-500 block mb-0.5">Binary: {(binarySize / 1024).toFixed(1)} KB</span>
            )}
            {statusText}
          </div>
        </div>

        {/* Right: Output / Serial Monitor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {stage === 'monitoring' ? (
            /* Serial Monitor */
            <div className="flex-1 flex flex-col">
              <div className="h-7 bg-[#1a1a1a] border-b border-gray-800 flex items-center px-3 text-[10px] text-gray-300 gap-2">
                <MonitorSpeaker size={11} />
                <span>Serial Monitor — {selectedPort} (Auto-baud)</span>
                <label className="ml-auto flex items-center gap-1 cursor-pointer text-gray-500 hover:text-gray-300">
                  <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="w-2.5 h-2.5 accent-white" />
                  Auto-scroll
                </label>
                <span className="text-gray-600 ml-3">{serialLines.length} lines</span>
              </div>
              <div ref={serialContainerRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-gray-200 bg-[#0a0a0a]">
                {serialLines.length === 0 ? (
                  <span className="text-gray-600">Waiting for data...</span>
                ) : (
                  serialLines.map((line, i) => (
                    <div key={i} className={`py-0.5 ${line.startsWith('[ERROR]') ? 'text-red-400' : ''}`}>
                      <span className="text-gray-700 mr-2 select-none">{String(i + 1).padStart(3, ' ')}</span>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Compile Output / Error Log */
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px]">
              {errorText ? (
                <div className="text-red-400 whitespace-pre-wrap leading-relaxed">
                  <div className="flex items-center gap-1.5 text-red-500 font-bold text-xs mb-2">
                    <AlertTriangle size={12} /> Compilation Error
                  </div>
                  {errorText}
                </div>
              ) : stage === 'success' ? (
                <div className="flex flex-col items-center justify-center h-full text-white gap-3">
                  <div className="bg-gray-800 border border-gray-700 p-3 rounded-full">
                    <Check size={36} strokeWidth={2} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">Successfully Flashed!</p>
                    <p className="text-xs text-gray-400 mt-2">Code is now running on your board.</p>
                    <button onClick={startSerialMonitor} className="mt-4 px-4 py-1.5 bg-gray-900 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 rounded-lg flex items-center gap-2 mx-auto transition-colors">
                      <Terminal size={12} /> Open Serial Monitor
                    </button>
                  </div>
                </div>
              ) : compileOutput ? (
                <div className="text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {compileOutput}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                  <Usb size={28} strokeWidth={1} />
                  <div className="text-center">
                    <p className="text-xs font-medium text-gray-400">Ready to Flash</p>
                    <p className="text-[10px] mt-1">Connect your board, select it, and hit Flash</p>
                    <p className="text-[10px] text-gray-700 mt-2">
                      Supported: Arduino Uno/Nano/Mega, ESP32, ESP32-S3, ESP32-C3
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
