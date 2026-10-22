'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Loader2,
  MonitorSpeaker,
  RefreshCw,
  Send,
  Square,
  Terminal,
  Upload,
  Usb,
  X,
} from 'lucide-react';
import { describeHardwareConnectionError, hardwareFetch, hardwareResponseError } from '@/lib/hardware-api';

export interface BoardOption {
  fqbn: string;
  name: string;
  chip: string;
  defaultBaud: number;
  family: string;
}

export const BOARD_OPTIONS: BoardOption[] = [
  { fqbn: 'arduino:avr:uno', name: 'Arduino Uno', chip: 'ATmega328P', defaultBaud: 9600, family: '8-bit AVR' },
  { fqbn: 'arduino:avr:nano', name: 'Arduino Nano', chip: 'ATmega328P', defaultBaud: 9600, family: '8-bit AVR' },
  { fqbn: 'arduino:avr:mega', name: 'Arduino Mega 2560', chip: 'ATmega2560', defaultBaud: 9600, family: '8-bit AVR' },
  { fqbn: 'esp32:esp32:esp32', name: 'ESP32 Dev Module', chip: 'ESP32', defaultBaud: 115200, family: 'Dual-core wireless MCU' },
  { fqbn: 'esp32:esp32:esp32s3', name: 'ESP32-S3', chip: 'ESP32-S3', defaultBaud: 115200, family: 'Dual-core wireless MCU' },
  { fqbn: 'esp32:esp32:esp32c3', name: 'ESP32-C3', chip: 'ESP32-C3', defaultBaud: 115200, family: 'RISC-V wireless MCU' },
  { fqbn: 'rp2040:rp2040:pico', name: 'Raspberry Pi Pico', chip: 'RP2040', defaultBaud: 115200, family: 'Dual-core Cortex-M0+' },
  { fqbn: 'STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8,upload_method=serialMethod', name: 'STM32 Blue Pill (serial bootloader)', chip: 'STM32F103C8T6', defaultBaud: 115200, family: 'Cortex-M3' },
];

interface SerialPortInfo {
  port: string;
  description?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  vid_pid?: string | null;
  serial_number?: string | null;
  board?: string | null;
  fqbn?: string | null;
}

interface FlashPanelProps {
  code: string;
  left?: number;
  onClose: () => void;
}

type FlashStage = 'idle' | 'detecting' | 'compiling' | 'uploading' | 'success' | 'error' | 'monitoring';

function inferMonitorBaud(source: string, fallback: number): number {
  const match = source.match(/\bSerial(?:\d+)?\.begin\s*\(\s*(\d+)\s*\)/i);
  const baud = match ? Number(match[1]) : NaN;
  return Number.isInteger(baud) && baud > 0 ? baud : fallback;
}

function parseSerialEvents(buffer: string): { events: string[]; remainder: string } {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() || '';
  const events = chunks.flatMap((chunk) => {
    const payload = chunk.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    return payload ? [payload] : [];
  });
  return { events, remainder };
}

export function FlashPanel({ code, left = 0, onClose }: FlashPanelProps) {
  const [stage, setStage] = useState<FlashStage>('detecting');
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [serviceReady, setServiceReady] = useState(false);
  const [serviceError, setServiceError] = useState('');
  const [statusText, setStatusText] = useState('Checking the local USB service...');
  const [errorText, setErrorText] = useState('');
  const [compileOutput, setCompileOutput] = useState('');
  const [serialLines, setSerialLines] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const serialControllerRef = useRef<AbortController | null>(null);
  const serialContainerRef = useRef<HTMLDivElement>(null);

  const currentBoard = useMemo(
    () => BOARD_OPTIONS.find((board) => board.fqbn === selectedBoard) || null,
    [selectedBoard],
  );
  const currentPort = useMemo(
    () => ports.find((port) => port.port === selectedPort) || null,
    [ports, selectedPort],
  );
  const baudFromSketch = useMemo(
    () => inferMonitorBaud(code, currentBoard?.defaultBaud || 115200),
    [code, currentBoard],
  );

  const refreshDevices = useCallback(async () => {
    setStage('detecting');
    setStatusText('Scanning USB serial ports...');
    setServiceError('');
    setErrorText('');
    try {
      const [statusResponse, portsResponse] = await Promise.all([
        hardwareFetch('/flash/status'),
        hardwareFetch('/flash/boards'),
      ]);
      if (!portsResponse.ok) throw new Error(await hardwareResponseError(portsResponse));
      const portPayload = await portsResponse.json() as { ports?: SerialPortInfo[] };
      const foundPorts = Array.isArray(portPayload.ports) ? portPayload.ports : [];
      setPorts(foundPorts);
      const recognizedPorts = foundPorts.filter((port) => port.fqbn && BOARD_OPTIONS.some((board) => board.fqbn === port.fqbn));
      const autoTargetPort = foundPorts.find((port) => port.port === selectedPort)
        || (foundPorts.length === 1 ? foundPorts[0] : recognizedPorts.length === 1 ? recognizedPorts[0] : null);

      let ready = false;
      let statusMessage = '';
      if (statusResponse.ok) {
        const statusPayload = await statusResponse.json() as { ready?: boolean; error?: string };
        ready = statusPayload.ready === true;
        statusMessage = statusPayload.error || '';
      } else {
        statusMessage = await hardwareResponseError(statusResponse);
      }
      setServiceReady(ready);
      setServiceError(statusMessage);

      setSelectedPort(autoTargetPort?.port || '');
      setSelectedBoard((previous) => {
        const detected = autoTargetPort?.fqbn;
        if (detected && BOARD_OPTIONS.some((board) => board.fqbn === detected)) return detected;
        return previous;
      });

      if (!ready) {
        setStatusText('USB ports were scanned, but the Arduino compiler is not ready.');
      } else if (!foundPorts.length) {
        setStatusText('No USB serial board detected. Connect a data-capable USB cable and scan again.');
      } else if (foundPorts.length === 1) {
        const detectedBoard = foundPorts[0].board || 'USB serial device';
        setStatusText('Detected ' + detectedBoard + ' on ' + foundPorts[0].port + '.');
      } else {
        setStatusText('Detected ' + foundPorts.length + ' USB serial ports. Select the board port.');
      }
    } catch (error) {
      const message = describeHardwareConnectionError(error);
      setServiceReady(false);
      setServiceError(message);
      setPorts([]);
      setSelectedPort('');
      setStatusText('Local hardware service is unavailable.');
    } finally {
      setStage((current) => current === 'detecting' ? 'idle' : current);
    }
  }, [selectedPort]);

  useEffect(() => {
    void refreshDevices();
    return () => serialControllerRef.current?.abort();
  }, [refreshDevices]);

  useEffect(() => {
    if (autoScroll && serialContainerRef.current) {
      serialContainerRef.current.scrollTop = serialContainerRef.current.scrollHeight;
    }
  }, [autoScroll, serialLines]);

  useEffect(() => {
    if (stage !== 'monitoring') setBaudRate(baudFromSketch);
  }, [baudFromSketch, stage]);

  const handlePortChange = (port: string) => {
    setSelectedPort(port);
    const detected = ports.find((item) => item.port === port);
    if (detected?.fqbn && BOARD_OPTIONS.some((board) => board.fqbn === detected.fqbn)) {
      setSelectedBoard(detected.fqbn);
      const board = BOARD_OPTIONS.find((item) => item.fqbn === detected.fqbn);
      if (board) setBaudRate(inferMonitorBaud(code, board.defaultBaud));
    }
    setStage('idle');
    setErrorText('');
  };

  const handleBoardChange = (fqbn: string) => {
    setSelectedBoard(fqbn);
    const board = BOARD_OPTIONS.find((item) => item.fqbn === fqbn);
    if (board) setBaudRate(inferMonitorBaud(code, board.defaultBaud));
    setErrorText('');
  };

  const handleCompile = useCallback(async () => {
    if (!code.trim()) {
      setErrorText('Open Code Preview on a circuit step to build or flash its firmware.');
      setStage('error');
      return;
    }
    if (!currentBoard) {
      setErrorText('Select a supported board target before compiling.');
      setStage('error');
      return;
    }
    setStage('compiling');
    setStatusText('Compiling with Arduino CLI for ' + currentBoard.name + '...');
    setErrorText('');
    setCompileOutput('');
    try {
      const response = await hardwareFetch('/flash/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, board: currentBoard.fqbn }),
      });
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string; detail?: string; stdout?: string; binary_size?: number };
      if (!response.ok || payload.status !== 'success') throw new Error(payload.error || payload.detail || await hardwareResponseError(response));
      setCompileOutput(payload.stdout || 'Compilation completed successfully.');
      setStatusText('Build succeeded for ' + currentBoard.name + '.');
      setStage('idle');
    } catch (error) {
      setErrorText(describeHardwareConnectionError(error));
      setStatusText('Compilation failed.');
      setStage('error');
    }
  }, [code, currentBoard]);

  const handleCompileAndFlash = useCallback(async () => {
    if (!code.trim()) {
      setErrorText('Open Code Preview on a circuit step to build or flash its firmware.');
      setStage('error');
      return;
    }
    if (!currentPort || !currentBoard) {
      setErrorText('Connect a USB serial board, select its port, and choose the correct board target.');
      setStage('error');
      return;
    }
    serialControllerRef.current?.abort();
    serialControllerRef.current = null;
    setStage('uploading');
    setStatusText('Preparing board support, compiling, then uploading to ' + currentPort.port + '...');
    setErrorText('');
    setCompileOutput('');
    try {
      const response = await hardwareFetch('/flash/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, board: currentBoard.fqbn, port: currentPort.port }),
      });
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string; detail?: string; message?: string; stdout?: string };
      if (!response.ok || payload.status !== 'success') throw new Error(payload.error || payload.detail || await hardwareResponseError(response));
      setCompileOutput(payload.stdout || payload.message || 'Firmware upload completed.');
      setStatusText(payload.message || 'Firmware uploaded successfully to ' + currentBoard.name + '.');
      setStage('success');
    } catch (error) {
      setErrorText(describeHardwareConnectionError(error));
      setStatusText('Compile or upload failed.');
      setStage('error');
    }
  }, [code, currentBoard, currentPort]);

  const stopSerialMonitor = useCallback(() => {
    serialControllerRef.current?.abort();
    serialControllerRef.current = null;
    setStage('idle');
    setStatusText('Serial monitor stopped.');
  }, []);

  const startSerialMonitor = useCallback(async () => {
    if (!currentPort) {
      setErrorText('Select a detected USB serial port before opening the monitor.');
      setStage('error');
      return;
    }
    serialControllerRef.current?.abort();
    const controller = new AbortController();
    serialControllerRef.current = controller;
    setSerialLines([]);
    setErrorText('');
    setStage('monitoring');
    setStatusText('Opening ' + currentPort.port + ' at ' + baudRate + ' baud...');
    try {
      const query = new URLSearchParams({ port: currentPort.port, baud: String(baudRate) });
      const response = await hardwareFetch('/flash/serial-monitor?' + query.toString(), {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await hardwareResponseError(response));
      if (!response.body) throw new Error('The local service did not open a serial stream.');
      setStatusText('Serial monitor connected to ' + currentPort.port + ' at ' + baudRate + ' baud.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSerialEvents(buffer);
        buffer = parsed.remainder;
        for (const event of parsed.events) {
          let record: { line?: string; error?: string };
          try { record = JSON.parse(event); } catch { continue; }
          if (record.error) throw new Error(record.error);
          if (typeof record.line === 'string') {
            setSerialLines((lines) => [...lines.slice(-499), record.line as string]);
          }
        }
      }
      if (!controller.signal.aborted) {
        setStage('idle');
        setStatusText('Serial stream ended.');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorText(describeHardwareConnectionError(error));
        setStage('error');
        setStatusText('Could not open the serial monitor.');
      }
    } finally {
      if (serialControllerRef.current === controller) serialControllerRef.current = null;
    }
  }, [baudRate, currentPort]);

  const handleSendSerialCommand = useCallback(async () => {
    const text = serialInput.trim();
    if (!text || !currentPort || stage !== 'monitoring' || isSending) return;
    setIsSending(true);
    try {
      const response = await hardwareFetch('/flash/serial-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: currentPort.port, text }),
      });
      if (!response.ok) throw new Error(await hardwareResponseError(response));
      setSerialLines((lines) => [...lines.slice(-499), '> ' + text]);
      setSerialInput('');
    } catch (error) {
      setErrorText(describeHardwareConnectionError(error));
    } finally {
      setIsSending(false);
    }
  }, [currentPort, isSending, serialInput, stage]);

  const busy = stage === 'compiling' || stage === 'uploading' || stage === 'detecting';
  const hasFirmware = Boolean(code.trim());
  const canFlash = serviceReady && hasFirmware && Boolean(currentPort && currentBoard) && !busy;
  const deviceLabel = currentBoard?.name || currentPort?.board || currentPort?.product || 'USB serial device';

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.18 }}
      aria-label="USB board and firmware tools"
      className="absolute bottom-0 right-0 z-50 overflow-hidden border-t border-[#29303a] bg-[#0d1117] text-white shadow-2xl"
      style={{ left, height: stage === 'monitoring' ? '58vh' : 'min(420px, 58vh)' }}
    >
      <header className="flex h-10 items-center justify-between border-b border-[#29303a] bg-[#151b23] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {currentPort ? <Cpu size={15} className="shrink-0 text-emerald-300" /> : <Usb size={15} className="shrink-0 text-slate-200" />}
          <span className="shrink-0 text-xs font-semibold text-slate-100">Hardware console</span>
          <span className="hidden h-4 w-px bg-slate-700 sm:block" />
          <span className="truncate text-[11px] text-slate-400">
            {currentPort ? `${deviceLabel} · ${currentPort.port}` : serviceReady ? ports.length ? 'Select a detected serial port' : 'No board detected' : 'Local USB service unavailable'}
          </span>
          <span className={'rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ' + (currentPort && serviceReady ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400')}>
            {stage === 'compiling' ? 'Building' : stage === 'uploading' ? 'Uploading' : stage === 'monitoring' ? 'Monitoring' : stage === 'error' ? 'Error' : currentPort && serviceReady ? 'Connected' : serviceReady ? 'Service ready' : 'Offline'}
          </span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close board panel">
          <X size={15} />
        </button>
      </header>

      <div className="flex h-[calc(100%-40px)] min-h-0">
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#29303a] bg-[#10151c] p-3">
          <div>
            <label htmlFor="hardware-port" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">USB serial port</label>
            <div className="flex gap-1.5">
              <select
                id="hardware-port"
                value={selectedPort}
                onChange={(event) => handlePortChange(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-[#0b0f14] px-2 py-2 text-xs text-slate-100 outline-none focus:border-slate-400"
              >
                <option value="">Select detected port</option>
                {ports.map((port) => {
                  const name = port.board || port.product || port.description || 'USB serial device';
                  const serial = port.serial_number ? ' / S/N ' + port.serial_number : '';
                  return <option key={port.port} value={port.port}>{port.port + ' - ' + name + serial}</option>;
                })}
              </select>
              <button
                type="button"
                onClick={() => void refreshDevices()}
                disabled={stage === 'detecting'}
                title="Scan USB ports"
                aria-label="Scan USB ports"
                className="rounded-md border border-slate-700 bg-[#171e27] p-2 text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={stage === 'detecting' ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="hardware-board" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Board target</label>
            <select
              id="hardware-board"
              value={selectedBoard}
              onChange={(event) => handleBoardChange(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-[#0b0f14] px-2 py-2 text-xs text-slate-100 outline-none focus:border-slate-400"
            >
              <option value="">Choose the exact board</option>
              {BOARD_OPTIONS.map((board) => <option key={board.fqbn} value={board.fqbn}>{board.name} - {board.family}</option>)}
            </select>
            {selectedBoard.startsWith('STMicroelectronics:') && <p className="mt-1.5 text-[10px] leading-4 text-amber-200">Blue Pill needs a USB-to-UART adapter and an STM32 serial bootloader; the board itself has no USB serial interface.</p>}
          </div>

          <div>
            <label htmlFor="hardware-baud" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Serial monitor baud</label>
            <select
              id="hardware-baud"
              value={baudRate}
              onChange={(event) => setBaudRate(Number(event.target.value))}
              className="w-full rounded-md border border-slate-700 bg-[#0b0f14] px-2 py-2 text-xs text-slate-100 outline-none focus:border-slate-400"
            >
              {[baudFromSketch, 9600, 19200, 38400, 57600, 115200, 230400].filter((value, index, all) => all.indexOf(value) === index).map((value) => (
                <option key={value} value={value}>{value} baud{value === baudFromSketch ? ' (from sketch)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void handleCompileAndFlash()}
              disabled={!canFlash}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {stage === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : stage === 'success' ? <Check size={14} /> : <Upload size={14} />}
              {stage === 'uploading' ? 'Compiling and uploading' : stage === 'success' ? 'Flash again' : 'Compile and flash'}
            </button>
            <button
              type="button"
              onClick={() => void handleCompile()}
              disabled={!serviceReady || !hasFirmware || !currentBoard || busy}
              title="Compile without uploading"
              className="rounded-md border border-slate-700 bg-[#171e27] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Build
            </button>
          </div>

          <button
            type="button"
            onClick={() => stage === 'monitoring' ? stopSerialMonitor() : void startSerialMonitor()}
            disabled={!serviceReady || !currentPort || busy}
            className="flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-[#171e27] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {stage === 'monitoring' ? <Square size={13} /> : <Terminal size={13} />}
            {stage === 'monitoring' ? 'Stop serial monitor' : 'Open serial monitor'}
          </button>

          <div className="mt-auto border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-400">
            {statusText}
            {currentPort && <div className="mt-1 font-mono text-slate-500">USB ID: {currentPort.vid_pid || 'Not reported'} · S/N: {currentPort.serial_number || 'Not reported by device'}</div>}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0e13]">
          {busy && <div className="h-0.5 w-full overflow-hidden bg-slate-800"><motion.div className="h-full w-1/3 bg-slate-200" animate={{ x: ['-100%', '300%'] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} /></div>}
          {serviceError && !serviceReady && (
            <div className="m-3 rounded-md border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-100">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> Local USB service not ready</div>
              <p className="mt-1 text-amber-100/80">{serviceError}</p>
              <p className="mt-2 text-amber-100/70">When using the Vercel site, start this computer&apos;s bridge in the project folder with <code className="rounded bg-black/30 px-1">npm run hardware:bridge</code>. The local app starts it automatically. Allow the browser&apos;s local-network prompt when it appears.</p>
            </div>
          )}
          {errorText && (
            <div className="m-3 flex min-h-0 flex-col rounded-md border border-red-900/70 bg-red-950/20 p-3 text-xs text-red-200">
              <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> {stage === 'error' ? 'Operation failed' : 'Serial write failed'}</div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5">{errorText}</pre>
            </div>
          )}
      {stage === 'success' && !errorText && (
        <div className="flex items-center gap-2 border-b border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 size={15} /> Firmware upload completed on {currentPort?.port}.
        </div>
      )}
      {compileOutput && !errorText && stage !== 'monitoring' && (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-slate-300">{compileOutput}</pre>
          )}
          {stage === 'monitoring' && !errorText && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-9 items-center justify-between border-b border-slate-800 px-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-2"><MonitorSpeaker size={13} /> {currentPort?.port} · {baudRate} baud</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label>
                  <button type="button" onClick={() => setSerialLines([])} className="hover:text-white">Clear</button>
                  <span>{serialLines.length} lines</span>
                </div>
              </div>
              <div ref={serialContainerRef} className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5 text-slate-300">
                {serialLines.length ? serialLines.map((line, index) => <div key={index} className="whitespace-pre-wrap">{line}</div>) : <p className="text-slate-600">Connected. Waiting for serial data.</p>}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void handleSendSerialCommand(); }} className="flex h-10 items-center gap-2 border-t border-slate-800 bg-[#10151c] px-3">
                <span className="font-mono text-slate-500">&gt;</span>
                <input value={serialInput} onChange={(event) => setSerialInput(event.target.value)} placeholder="Send text to the board" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600" />
                <button type="submit" disabled={!serialInput.trim() || isSending} className="flex items-center gap-1.5 rounded bg-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-slate-950 disabled:opacity-40">{isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send</button>
              </form>
            </div>
          )}
          {!errorText && !compileOutput && stage !== 'monitoring' && (
            <div className="flex flex-1 flex-col items-center justify-center p-5 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-[#111821]">
                {currentPort ? <Cpu size={21} className="text-slate-200" /> : <Usb size={21} className="text-slate-400" />}
              </div>
              {stage === 'success' ? (
                <>
                  <CheckCircle2 size={19} className="mb-2 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-slate-100">Upload complete</h2>
                  <p className="mt-1 max-w-lg text-xs text-slate-400">Firmware was uploaded to {currentBoard?.name} on {currentPort?.port}. Open the serial monitor to confirm the board&apos;s output.</p>
                </>
              ) : currentPort ? (
                <>
                  <h2 className="text-sm font-semibold text-slate-100">{deviceLabel} connected</h2>
                  <p className="mt-1 max-w-lg font-mono text-xs text-slate-400">{currentPort.port} · {currentBoard ? currentBoard.chip + ' · ' + currentBoard.fqbn : 'Choose the exact board target in the left panel.'}</p>
                  <p className="mt-1 max-w-lg text-[11px] text-slate-500">{currentPort.description || currentPort.product || 'USB serial device'}{currentPort.vid_pid ? ' · USB ID ' + currentPort.vid_pid : ''}</p>
                  {currentPort.serial_number && <p className="mt-1 font-mono text-[10px] text-slate-500">S/N {currentPort.serial_number}</p>}
                  {!hasFirmware && <p className="mt-3 text-[11px] text-slate-400">Serial Monitor is ready. Open Code Preview on a circuit step to enable Build and Flash.</p>}
                </>
              ) : (
                <>
                  <h2 className="text-sm font-semibold text-slate-100">Connect a microcontroller over USB</h2>
                  <p className="mt-1 max-w-lg text-xs text-slate-400">Connect a data-capable cable. The local bridge scans serial ports and fills in the board identity when its USB descriptor is known.</p>
                </>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[10px] text-slate-400">
                <span className="rounded border border-slate-800 px-2 py-1">Arduino Uno / Nano / Mega</span>
                <span className="rounded border border-slate-800 px-2 py-1">ESP32 / S3 / C3</span>
                <span className="rounded border border-slate-800 px-2 py-1">RP2040 Pico</span>
                <span className="rounded border border-slate-800 px-2 py-1">STM32 Blue Pill with UART bootloader</span>
              </div>
              {!currentPort && serviceReady && ports.length > 0 && <p className="mt-3 text-xs text-amber-200">Choose a serial port from the left panel. Some boards do not report a USB serial number.</p>}
            </div>
          )}
        </main>
      </div>
    </motion.section>
  );
}
