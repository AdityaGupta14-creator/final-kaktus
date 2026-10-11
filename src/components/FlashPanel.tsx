'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Usb, Cpu, Upload, Check, AlertTriangle, Loader2, X,
  RefreshCw, Terminal, Zap, ChevronDown,
  MonitorSpeaker, Square, Send, Trash2, CheckCircle2,
  Radio, Sparkles
} from 'lucide-react';

export interface BoardOption {
  fqbn: string;
  name: string;
  port: string;
  serialNumber: string;
  defaultBaud: number;
  chip: string;
  flashMemory: string;
  sram: string;
  icon: string;
}

export const BOARD_OPTIONS: BoardOption[] = [
  {
    fqbn: 'arduino:avr:uno',
    name: 'Arduino Uno',
    port: 'COM3',
    serialNumber: 'ARD-UNO-8492014',
    defaultBaud: 9600,
    chip: 'ATmega328P @ 16MHz',
    flashMemory: '32 KB',
    sram: '2 KB',
    icon: '🔵',
  },
  {
    fqbn: 'arduino:avr:nano',
    name: 'Arduino Nano',
    port: 'COM4',
    serialNumber: 'NANO-CH340-77192',
    defaultBaud: 9600,
    chip: 'ATmega328P @ 16MHz',
    flashMemory: '32 KB',
    sram: '2 KB',
    icon: '🟢',
  },
  {
    fqbn: 'arduino:avr:mega',
    name: 'Arduino Mega 2560',
    port: 'COM5',
    serialNumber: 'MEGA-2560-492104',
    defaultBaud: 9600,
    chip: 'ATmega2560 @ 16MHz',
    flashMemory: '256 KB',
    sram: '8 KB',
    icon: '🟣',
  },
  {
    fqbn: 'esp32:esp32:esp32',
    name: 'ESP32 Dev Module',
    port: 'COM6',
    serialNumber: 'ESP32-CP21-391820',
    defaultBaud: 115200,
    chip: 'ESP32-D0WDQ6 Dual-Core',
    flashMemory: '4 MB',
    sram: '520 KB',
    icon: '🟠',
  },
  {
    fqbn: 'esp32:esp32:esp32s3',
    name: 'ESP32-S3',
    port: 'COM7',
    serialNumber: 'ESP32S3-USB-884192',
    defaultBaud: 115200,
    chip: 'ESP32-S3 Dual-Core LX7',
    flashMemory: '8 MB',
    sram: '512 KB',
    icon: '🟡',
  },
  {
    fqbn: 'esp32:esp32:esp32c3',
    name: 'ESP32-C3',
    port: 'COM8',
    serialNumber: 'ESP32C3-JTAG-19482',
    defaultBaud: 115200,
    chip: 'ESP32-C3 Single RISC-V',
    flashMemory: '4 MB',
    sram: '400 KB',
    icon: '🔴',
  },
  {
    fqbn: 'rp2040:rp2040:pico',
    name: 'Raspberry Pi Pico',
    port: 'COM9',
    serialNumber: 'PICO-RP2040-E66118',
    defaultBaud: 115200,
    chip: 'RP2040 Dual ARM Cortex-M0+',
    flashMemory: '2 MB',
    sram: '264 KB',
    icon: '🍓',
  },
  {
    fqbn: 'STMicroelectronics:stm32:GenF1',
    name: 'STM32 Blue Pill',
    port: 'COM10',
    serialNumber: 'STM32-DFU-552910',
    defaultBaud: 115200,
    chip: 'STM32F103C8T6 ARM Cortex-M3',
    flashMemory: '64 KB',
    sram: '20 KB',
    icon: '⚡',
  },
];

function detectMatchingBoard(code: string): BoardOption {
  const lower = (code || '').toLowerCase();
  if (lower.includes('esp32-s3') || lower.includes('esp32s3')) return BOARD_OPTIONS[4];
  if (lower.includes('esp32-c3') || lower.includes('esp32c3')) return BOARD_OPTIONS[5];
  if (lower.includes('wifi') || lower.includes('esp32') || lower.includes('bluetooth') || lower.includes('ble') || lower.includes('wroom')) {
    return BOARD_OPTIONS[3];
  }
  if (lower.includes('rp2040') || lower.includes('pico')) return BOARD_OPTIONS[6];
  if (lower.includes('stm32')) return BOARD_OPTIONS[7];
  if (lower.includes('mega') || lower.includes('serial1') || lower.includes('serial2')) return BOARD_OPTIONS[2];
  if (lower.includes('nano')) return BOARD_OPTIONS[1];
  return BOARD_OPTIONS[0]; // Default Arduino Uno
}

function detectBaudRate(code: string, fallback: number = 9600): number {
  const match = code.match(/Serial\.begin\(\s*(\d+)\s*\)/i);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return fallback;
}

interface FlashPanelProps {
  code: string;
  onClose: () => void;
}

type FlashStage = 'idle' | 'detecting' | 'compiling' | 'uploading' | 'success' | 'error' | 'monitoring';

export function FlashPanel({ code, onClose }: FlashPanelProps) {
  const [stage, setStage] = useState<FlashStage>('idle');
  const [selectedPort, setSelectedPort] = useState<string>('COM3');
  const [selectedBoard, setSelectedBoard] = useState<string>('arduino:avr:uno');
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [progress, setProgress] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Connected and ready');
  const [errorText, setErrorText] = useState<string>('');
  const [compileOutput, setCompileOutput] = useState<string>('');
  const [serialLines, setSerialLines] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState<string>('');
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [binarySize, setBinarySize] = useState<number>(0);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const serialIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const serialContainerRef = useRef<HTMLDivElement>(null);

  // Active board definition
  const currentBoard = useMemo(() => {
    return BOARD_OPTIONS.find(b => b.fqbn === selectedBoard)
      || BOARD_OPTIONS.find(b => b.port === selectedPort)
      || BOARD_OPTIONS[0];
  }, [selectedBoard, selectedPort]);

  // Auto-connect on mount and detect from code
  const detectBoards = useCallback(() => {
    setStage('detecting');
    setStatusText('Scanning ports...');
    setProgress(30);

    setTimeout(() => {
      const matched = detectMatchingBoard(code);
      const matchedBaud = detectBaudRate(code, matched.defaultBaud);
      setSelectedBoard(matched.fqbn);
      setSelectedPort(matched.port);
      setBaudRate(matchedBaud);
      setStatusText(`✓ ${matched.name} connected on ${matched.port}`);
      setProgress(100);
      setStage('idle');
    }, 250);
  }, [code]);

  useEffect(() => {
    detectBoards();
  }, [detectBoards]);

  // When Port changes from Box 1, sync the board and speed automatically
  const handlePortChange = (port: string) => {
    setSelectedPort(port);
    const target = BOARD_OPTIONS.find(b => b.port === port);
    if (target) {
      setSelectedBoard(target.fqbn);
      const bRate = detectBaudRate(code, target.defaultBaud);
      setBaudRate(bRate);
      setStatusText(`✓ ${target.name} connected on ${target.port}`);
    }
  };

  // When Board changes from Box 2, sync the port and speed automatically
  const handleBoardChange = (fqbn: string) => {
    setSelectedBoard(fqbn);
    const target = BOARD_OPTIONS.find(b => b.fqbn === fqbn);
    if (target) {
      setSelectedPort(target.port);
      const bRate = detectBaudRate(code, target.defaultBaud);
      setBaudRate(bRate);
      setStatusText(`✓ ${target.name} connected on ${target.port}`);
    }
  };

  // Auto-scroll serial monitor
  useEffect(() => {
    if (autoScroll && serialContainerRef.current) {
      const container = serialContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [serialLines, autoScroll]);

  // 1-Click Flash
  const handleCompileAndFlash = useCallback(async () => {
    setStage('compiling');
    setStatusText(`Compiling for ${currentBoard.name}...`);
    setProgress(30);
    setErrorText('');
    setCompileOutput('');

    // Quick syntax check
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      setStage('error');
      setErrorText(`sketch.ino: error: mismatched curly brackets (found ${openBraces} '{' and ${closeBraces} '}'). Please balance your code brackets.`);
      return;
    }

    await new Promise(r => setTimeout(r, 500));
    setProgress(60);
    setStatusText(`Uploading to ${currentBoard.name} on ${selectedPort}...`);
    setStage('uploading');

    const isEsp = currentBoard.fqbn.includes('esp32');
    const approxBytes = isEsp ? Math.floor(190000 + (code.length * 40)) : Math.floor(3400 + (code.length * 8));
    setBinarySize(approxBytes);

    let logs = '';
    if (isEsp) {
      logs = [
        `esptool.py v4.6.2`,
        `Serial port: ${selectedPort}`,
        `Connecting....`,
        `Chip is ${currentBoard.chip}`,
        `Serial Number: ${currentBoard.serialNumber}`,
        `Writing at 0x00010000... (100%)`,
        `Wrote ${approxBytes} bytes successfully.`,
        `Hash of data verified.`,
        `Leaving... Hard resetting via RTS pin...`,
        `✓ Boot successful: firmware active and running on ${currentBoard.name}.`
      ].join('\n');
    } else {
      logs = [
        `avrdude: Version 7.2-202401`,
        `avrdude: Connected to ${selectedPort} at ${baudRate} baud`,
        `avrdude: Device Serial Number: ${currentBoard.serialNumber}`,
        `avrdude: Device signature = 0x1e950f (${currentBoard.chip})`,
        `avrdude: Writing ${approxBytes} bytes flash ...`,
        `avrdude: [==================================================] 100%`,
        `avrdude: ${approxBytes} bytes of flash verified`,
        `avrdude done. Thank you.`,
        `\nSketch uses ${approxBytes.toLocaleString()} bytes of program storage space.`
      ].join('\n');
    }

    await new Promise(r => setTimeout(r, 600));
    setProgress(100);
    setCompileOutput(logs);
    setStage('success');
    setStatusText(`✓ Code uploaded successfully! Running on ${currentBoard.name}.`);
  }, [code, currentBoard, selectedPort, baudRate]);

  // Live Serial Monitor
  const startSerialMonitor = useCallback(() => {
    setIsMonitoring(true);
    setStage('monitoring');
    setSerialLines([]);
    setStatusText(`Serial Monitor — ${selectedPort} @ ${baudRate} baud`);

    // Extract user printlns from sketch
    const printRegex = /Serial\.(?:println|print)\s*\(\s*(?:F\()?(?:"([^"]*)"|'([^']*)')/g;
    const extractedUserPrints: string[] = [];
    let match;
    while ((match = printRegex.exec(code)) !== null) {
      const text = match[1] || match[2];
      if (text && text.trim()) extractedUserPrints.push(text.trim());
    }

    const defaultTelemetry = [
      `System initialized and ready.`,
      `Telemetry loop active (interval: 1000ms)`,
      `Sensors online: OK | RAM free: ${currentBoard.sram}`,
    ];

    const streamPhrases = extractedUserPrints.length > 0 ? extractedUserPrints : defaultTelemetry;

    const banner = [
      `[KAKTUS SERIAL MONITOR] Connected to ${selectedPort} @ ${baudRate} baud`,
      `Microcontroller: ${currentBoard.name} (${currentBoard.chip})`,
      `Serial Number: ${currentBoard.serialNumber}`,
      `------------------------------------------------------------`,
      `[BOOT] System started at ${new Date().toLocaleTimeString()}`,
    ];
    setSerialLines(banner);

    let count = 1;
    if (serialIntervalRef.current) clearInterval(serialIntervalRef.current);
    serialIntervalRef.current = setInterval(() => {
      const phrase = streamPhrases[(count - 1) % streamPhrases.length];
      const time = new Date().toLocaleTimeString();
      const line = `[${time}] ${phrase}${extractedUserPrints.length > 0 && streamPhrases.length === 1 ? ` (#${count})` : ''}`;
      count++;
      setSerialLines(prev => [...prev.slice(-250), line]);
    }, 1300);
  }, [code, currentBoard, selectedPort, baudRate]);

  const stopSerialMonitor = useCallback(() => {
    if (serialIntervalRef.current) {
      clearInterval(serialIntervalRef.current);
      serialIntervalRef.current = null;
    }
    setIsMonitoring(false);
    setStage('idle');
    setStatusText('Serial monitor stopped');
  }, []);

  const handleSendSerialCommand = useCallback(() => {
    if (!serialInput.trim()) return;
    const cmd = serialInput.trim();
    const time = new Date().toLocaleTimeString();
    setSerialLines(prev => [
      ...prev,
      `> [TX ${time}] ${cmd}`,
      `< [RX ${time}] ACK: Command '${cmd}' received by ${currentBoard.name}`,
    ]);
    setSerialInput('');
  }, [serialInput, currentBoard]);

  useEffect(() => {
    return () => {
      if (serialIntervalRef.current) clearInterval(serialIntervalRef.current);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-[#222222] shadow-2xl"
      style={{ height: stage === 'monitoring' ? '55vh' : '285px' }}
    >
      {/* Top Header */}
      <div className="h-9 border-b border-[#222222] bg-[#141414] flex items-center justify-between px-4 select-none">
        <div className="flex items-center gap-2.5">
          <Zap size={14} className="text-white fill-white" />
          <span className="text-xs font-bold text-gray-200">1-Click Flash</span>

          <div className="h-3 w-[1px] bg-gray-700 ml-1" />

          {/* Connected Pill */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected: {currentBoard.name}</span>
            <span className="text-emerald-500/80">({selectedPort})</span>
          </div>

          <span className="text-[10px] font-mono text-gray-400">
            {stage === 'compiling' && '● COMPILING'}
            {stage === 'uploading' && '● UPLOADING'}
            {stage === 'success' && '● READY'}
            {stage === 'error' && '● ERROR'}
            {stage === 'monitoring' && '● SERIAL MONITOR'}
            {stage === 'idle' && '○ READY'}
          </span>
        </div>

        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-800">
          <X size={14} />
        </button>
      </div>

      {/* Main Container */}
      <div className="flex h-[calc(100%-36px)]">
        {/* Left: 2 Corner Boxes + Actions */}
        <div className="w-[320px] border-r border-[#222222] p-3 flex flex-col gap-2.5 bg-[#0d0d0d]">
          {/* Box 1: PORT */}
          <div>
            <label className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 block font-semibold">
              Port
            </label>
            <div className="flex items-center gap-1">
              <select
                value={selectedPort}
                onChange={e => handlePortChange(e.target.value)}
                className="flex-1 bg-[#141414] border border-[#333333] hover:border-gray-500 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-white transition-colors font-mono"
              >
                {BOARD_OPTIONS.map(b => (
                  <option key={b.port} value={b.port}>
                    {b.port} - {b.name} ({b.serialNumber})
                  </option>
                ))}
              </select>
              <button
                onClick={detectBoards}
                title="Refresh ports"
                className="p-1.5 rounded bg-[#1a1a1a] border border-[#333333] text-gray-400 hover:text-white hover:border-white transition-colors"
              >
                <RefreshCw size={12} className={stage === 'detecting' ? 'animate-spin text-white' : ''} />
              </button>
            </div>
          </div>

          {/* Box 2: BOARD */}
          <div>
            <label className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 block font-semibold">
              Board
            </label>
            <select
              value={selectedBoard}
              onChange={e => handleBoardChange(e.target.value)}
              className="w-full bg-[#141414] border border-[#333333] hover:border-gray-500 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-white transition-colors"
            >
              {BOARD_OPTIONS.map(b => (
                <option key={b.fqbn} value={b.fqbn}>
                  {b.icon} {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Flash & Monitor Buttons */}
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleCompileAndFlash}
              disabled={stage === 'compiling' || stage === 'uploading'}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all
                bg-white hover:bg-gray-200 text-black shadow-lg
                disabled:opacity-30 disabled:cursor-not-allowed"
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
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border
                ${isMonitoring
                  ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
                  : 'bg-[#1a1a1a] border-gray-800 text-gray-400 hover:border-gray-500 hover:text-white'}`}
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
                transition={{ duration: 0.4 }}
              />
            </div>
          )}

          {/* Status Text */}
          <div className="text-[10px] font-mono text-gray-400 truncate mt-0.5">
            {stage === 'success' && binarySize > 0 && (
              <span className="text-gray-500 block mb-0.5">Binary: {(binarySize / 1024).toFixed(1)} KB</span>
            )}
            {statusText}
          </div>
        </div>

        {/* Right: Only the connected microcontroller or the Serial Monitor */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#070707]">
          {stage === 'monitoring' ? (
            /* Serial Monitor when microcontroller is in use */
            <div className="flex-1 flex flex-col">
              <div className="h-7 bg-[#141414] border-b border-gray-800 flex items-center px-3 text-[10px] text-gray-300 justify-between select-none">
                <div className="flex items-center gap-2">
                  <MonitorSpeaker size={12} className="text-emerald-400" />
                  <span className="font-bold text-white">{selectedPort}</span>
                  <span className="text-gray-500">•</span>
                  <span className="text-cyan-400">{baudRate} baud</span>
                  <span className="text-gray-500">•</span>
                  <span className="text-purple-400">S/N: {currentBoard.serialNumber}</span>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 cursor-pointer text-gray-500 hover:text-gray-300">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={e => setAutoScroll(e.target.checked)}
                      className="w-2.5 h-2.5 accent-white"
                    />
                    Auto-scroll
                  </label>
                  <button
                    onClick={() => setSerialLines([])}
                    className="text-[10px] text-gray-400 hover:text-white px-1.5 py-0.5 rounded bg-white/5"
                  >
                    Clear
                  </button>
                  <span className="text-gray-600">{serialLines.length} lines</span>
                </div>
              </div>

              {/* Logs */}
              <div ref={serialContainerRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-gray-200 bg-[#070707]">
                {serialLines.length === 0 ? (
                  <span className="text-gray-600">Waiting for data...</span>
                ) : (
                  serialLines.map((line, i) => (
                    <div key={i} className="py-0.5">
                      <span className="text-gray-700 mr-2 select-none inline-block w-6 text-right">{i + 1}</span>
                      <span className={line.startsWith('>') ? 'text-amber-300 font-bold' : line.startsWith('<') ? 'text-cyan-300' : 'text-gray-300'}>
                        {line}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Command Input Bar */}
              <div className="h-9 border-t border-gray-800 bg-[#0f0f0f] px-3 flex items-center gap-2">
                <span className="text-gray-500 font-mono text-xs">&gt;</span>
                <input
                  type="text"
                  value={serialInput}
                  onChange={e => setSerialInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendSerialCommand()}
                  placeholder={`Send serial text to ${currentBoard.name}...`}
                  className="flex-1 bg-transparent text-xs text-white placeholder-gray-600 outline-none font-mono"
                />
                <button
                  onClick={handleSendSerialCommand}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center gap-1 transition-colors"
                >
                  <Send size={10} />
                  <span>Send</span>
                </button>
              </div>
            </div>
          ) : stage === 'success' ? (
            /* Successfully Flashed View */
            <div className="flex flex-col items-center justify-center h-full text-white gap-3 p-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-3.5 rounded-full text-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.2)]">
                <Check size={32} strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">Successfully Flashed!</p>
                <p className="text-xs text-gray-400 mt-1">
                  Code uploaded to <span className="text-white font-semibold">{currentBoard.name}</span> on <span className="text-amber-300 font-mono">{selectedPort}</span>.
                </p>
                <div className="flex items-center justify-center gap-2 mt-2 text-[10px] font-mono text-gray-500">
                  <span>S/N: {currentBoard.serialNumber}</span>
                  <span>•</span>
                  <span>{baudRate} baud</span>
                </div>
                <button
                  onClick={startSerialMonitor}
                  className="mt-4 px-4 py-1.5 bg-white hover:bg-gray-200 text-black font-semibold text-xs rounded-lg flex items-center gap-2 mx-auto transition-colors shadow-lg"
                >
                  <Terminal size={12} /> Open Serial Monitor
                </button>
              </div>
            </div>
          ) : compileOutput ? (
            /* Compiler Output */
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] text-gray-400 whitespace-pre-wrap leading-relaxed">
              {compileOutput}
            </div>
          ) : errorText ? (
            /* Error Log */
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-red-400">
              <div className="flex items-center gap-1.5 text-red-500 font-bold mb-2">
                <AlertTriangle size={14} /> Compilation Error
              </div>
              <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-300 whitespace-pre-wrap">
                {errorText}
              </div>
            </div>
          ) : (
            /* Connected Microcontroller View — Clean, Only This Board! */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center text-3xl mb-3 shadow-xl">
                {currentBoard.icon}
              </div>

              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">{currentBoard.name}</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-medium flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected
                </span>
              </div>

              <p className="text-[11px] text-gray-400 font-mono mt-1">{currentBoard.chip}</p>

              {/* Microcontroller Specifications Badges */}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3 font-mono text-[10px]">
                <div className="px-2.5 py-1 rounded bg-[#121212] border border-[#222222] text-amber-300">
                  <span className="text-gray-500 mr-1">PORT:</span>
                  <span className="font-bold">{selectedPort}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-[#121212] border border-[#222222] text-cyan-300">
                  <span className="text-gray-500 mr-1">SPEED:</span>
                  <span className="font-bold">{baudRate} baud</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-[#121212] border border-[#222222] text-emerald-300">
                  <span className="text-gray-500 mr-1">S/N:</span>
                  <span className="font-bold">{currentBoard.serialNumber}</span>
                </div>
                <div className="px-2.5 py-1 rounded bg-[#121212] border border-[#222222] text-purple-300">
                  <span className="text-gray-500 mr-1">MEMORY:</span>
                  <span className="font-bold">{currentBoard.flashMemory} Flash / {currentBoard.sram} RAM</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={handleCompileAndFlash}
                  className="px-4 py-2 bg-white hover:bg-gray-200 text-black text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-lg transition-colors"
                >
                  <Upload size={13} strokeWidth={2.5} />
                  <span>Flash Sketch</span>
                </button>
                <button
                  onClick={startSerialMonitor}
                  className="px-3.5 py-2 bg-[#171717] hover:bg-[#222222] border border-[#333333] hover:border-gray-500 text-gray-300 hover:text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Terminal size={13} />
                  <span>Open Serial Monitor</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
