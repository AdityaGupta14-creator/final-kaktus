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
  Wifi,
  X,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import {
  BridgeConnectionState,
  checkBridgeHealthWithRetry,
  describeHardwareConnectionError,
  hardwareFetch,
  hardwareResponseError,
} from '@/lib/hardware-api';

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

/* ── Known USB VID:PID → Board mapping for Web Serial detection ── */
const USB_VID_PID_MAP: Record<string, BoardOption> = {
  '1A86:7523': BOARD_OPTIONS[0], // CH340 → Arduino Uno
  '0403:6001': BOARD_OPTIONS[0], // FTDI → Arduino Uno
  '2341:0043': BOARD_OPTIONS[0], // Arduino Uno (official)
  '2341:0001': BOARD_OPTIONS[0], // Arduino Uno (R1)
  '2341:0010': BOARD_OPTIONS[2], // Arduino Mega 2560
  '2341:0042': BOARD_OPTIONS[2], // Arduino Mega 2560 (R3)
  '2341:0058': BOARD_OPTIONS[1], // Arduino Nano
  '10C4:EA60': BOARD_OPTIONS[3], // CP2102 → ESP32
  '10C4:EA70': BOARD_OPTIONS[3], // CP2104 → ESP32
  '303A:0002': BOARD_OPTIONS[4], // ESP32-S2 (map to S3)
  '303A:1001': BOARD_OPTIONS[4], // ESP32-S3
  '303A:1002': BOARD_OPTIONS[5], // ESP32-C3
  '2E8A:0005': BOARD_OPTIONS[6], // RP2040 Pico
  '2E8A:000A': BOARD_OPTIONS[6], // RP2040 Pico W
  '0483:5740': BOARD_OPTIONS[7], // STM32 Virtual COM
};

interface SerialPortInfoWeb {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfoWeb;
}

function identifyBoardFromWebSerial(port: SerialPort): BoardOption | null {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return null;
  const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
  const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
  return USB_VID_PID_MAP[`${vid}:${pid}`] || null;
}

function getVidPidString(port: SerialPort): string {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return '';
  const vid = info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
  const pid = info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
  return `${vid}:${pid}`;
}

interface SerialPortInfo {
  port: string;
  description?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  vid_pid?: string | null;
  serial_number?: string | null;
  board?: string | null;
  fqbn?: string | null;
  /** Web Serial port reference (only in browser mode) */
  _webSerialPort?: SerialPort;
}

interface FlashPanelProps {
  code: string;
  left?: number;
  onClose: () => void;
  /** Called when the panel wants the IDE to start the hardware bridge (e.g. via terminal). */
  onRequestBridgeSetup?: () => void;
  /** If true, the IDE is currently running the bridge setup. */
  bridgeSetupRunning?: boolean;
}

type FlashStage = 'idle' | 'detecting' | 'compiling' | 'uploading' | 'success' | 'error' | 'monitoring';
type BackendMode = 'checking' | 'local' | 'browser';

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

export function FlashPanel({ code, left = 0, onClose, onRequestBridgeSetup, bridgeSetupRunning }: FlashPanelProps) {
  const [stage, setStage] = useState<FlashStage>('detecting');
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [bridgeState, setBridgeState] = useState<BridgeConnectionState>('checking');
  const [selectedBoard, setSelectedBoard] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [serviceReady, setServiceReady] = useState(false);
  const [serviceError, setServiceError] = useState('');
  const [statusText, setStatusText] = useState('Checking connection...');
  const [cloudSetupBusy, setCloudSetupBusy] = useState(false);
  const [cloudSetupMessage, setCloudSetupMessage] = useState('');
  const [pairedBridgeId, setPairedBridgeId] = useState('');
  const [errorText, setErrorText] = useState('');
  const [compileOutput, setCompileOutput] = useState('');
  const [serialLines, setSerialLines] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<BackendMode>('checking');
  const serialControllerRef = useRef<AbortController | null>(null);
  const serialContainerRef = useRef<HTMLDivElement>(null);
  const webSerialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const webSerialWriterRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const webSerialPortRef = useRef<SerialPort | null>(null);
  const bridgePollRef = useRef<NodeJS.Timeout | null>(null);

  const currentBoard = useMemo(
    () => BOARD_OPTIONS.find((board) => board.fqbn === selectedBoard) || null,
    [selectedBoard],
  );
  const currentPort = useMemo(
    () => ports.find((port) => port.port === selectedPort) || null,
    [ports, selectedPort],
  );
  const hostedProduction = typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && window.location.hostname !== 'localhost'
    && window.location.hostname !== '127.0.0.1';

  useEffect(() => {
    setPairedBridgeId(window.localStorage.getItem('kaktus.hardwareBridgeId') || '');
  }, []);

  const setupCloudBridge = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setCloudSetupMessage('Sign in before pairing a hardware computer.');
      return;
    }
    setCloudSetupBusy(true);
    setCloudSetupMessage('Creating a secure, account-scoped pairing file…');
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/hardware/relay', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', label: typeof navigator !== 'undefined' ? navigator.platform : 'This computer' }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as { bridgeId?: string; bridgeToken?: string; apiBase?: string; error?: string };
      if (!response.ok || !payload.bridgeId || !payload.bridgeToken || !payload.apiBase) {
        throw new Error(payload.error || `Pairing failed (HTTP ${response.status}).`);
      }
      window.localStorage.setItem('kaktus.hardwareBridgeId', payload.bridgeId);
      setPairedBridgeId(payload.bridgeId);
      const config = new Blob([JSON.stringify({ apiBase: payload.apiBase, bridgeId: payload.bridgeId, bridgeToken: payload.bridgeToken }, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(config);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = 'kaktus-hardware-bridge.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setCloudSetupMessage('Pairing file downloaded. On the computer connected to the board, run: npm run hardware:bridge:cloud -- --config "<path-to-downloaded-file>". The agent starts the USB service and connects outward over HTTPS. Keep the pairing file private.');
    } catch (error) {
      setCloudSetupMessage(error instanceof Error ? error.message : 'Could not pair this computer.');
    } finally {
      setCloudSetupBusy(false);
    }
  }, []);

  const revokeCloudBridge = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !pairedBridgeId) return;
    setCloudSetupBusy(true);
    try {
      const response = await fetch('/api/hardware/relay', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', bridgeId: pairedBridgeId }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `Could not revoke bridge (HTTP ${response.status}).`);
      window.localStorage.removeItem('kaktus.hardwareBridgeId');
      setPairedBridgeId('');
      setCloudSetupMessage('This computer’s relay key has been revoked. Pair it again to reconnect.');
    } catch (error) {
      setCloudSetupMessage(error instanceof Error ? error.message : 'Could not revoke the paired computer.');
    } finally {
      setCloudSetupBusy(false);
    }
  }, [pairedBridgeId]);
  const baudFromSketch = useMemo(
    () => inferMonitorBaud(code, currentBoard?.defaultBaud || 115200),
    [code, currentBoard],
  );

  /* ── Detect ports via Web Serial API (browser-native, works on production) ── */
  const refreshDevicesWebSerial = useCallback(async () => {
    if (!('serial' in navigator)) {
      setServiceError('Web Serial API is not supported in this browser. Use Chrome or Edge.');
      setPorts([]);
      setStatusText('Web Serial not supported.');
      return;
    }
    setStage('detecting');
    setStatusText('Scanning USB devices via browser...');
    setServiceError('');
    setErrorText('');
    try {
      const webPorts: SerialPort[] = (navigator as any).serial ? await (navigator as any).serial.getPorts() : [];
      const foundPorts: SerialPortInfo[] = webPorts.map((port: SerialPort, index: number) => {
        const board = identifyBoardFromWebSerial(port);
        const vidPid = getVidPidString(port);
        return {
          port: `WebSerial-${index}`,
          board: board?.name || null,
          fqbn: board?.fqbn || null,
          vid_pid: vidPid || null,
          product: board?.chip || 'USB Serial Device',
          description: board ? `${board.name} (${board.chip})` : 'USB Serial Device',
          _webSerialPort: port,
        };
      });
      setPorts(foundPorts);
      setServiceReady(true);

      const recognizedPorts = foundPorts.filter((p) => p.fqbn && BOARD_OPTIONS.some((b) => b.fqbn === p.fqbn));
      const autoTarget = foundPorts.find((p) => p.port === selectedPort)
        || (foundPorts.length === 1 ? foundPorts[0] : recognizedPorts.length === 1 ? recognizedPorts[0] : null);

      if (autoTarget) {
        setSelectedPort(autoTarget.port);
        if (autoTarget.fqbn && BOARD_OPTIONS.some((b) => b.fqbn === autoTarget.fqbn)) {
          setSelectedBoard(autoTarget.fqbn);
        }
      }

      if (!foundPorts.length) {
        setStatusText('No authorized USB device. Click the refresh button to pair a device.');
      } else if (foundPorts.length === 1) {
        setStatusText(`Connected: ${foundPorts[0].board || 'USB device'} via Web Serial.`);
      } else {
        setStatusText(`${foundPorts.length} USB devices detected. Select a port.`);
      }
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : 'Could not scan USB devices.');
      setPorts([]);
      setStatusText('USB scan failed.');
    } finally {
      setStage((current) => current === 'detecting' ? 'idle' : current);
    }
  }, [selectedPort]);

  /* ── Detect ports via local backend (localhost:8000) ── */
  const refreshDevicesBackend = useCallback(async () => {
    setStage('detecting');
    setBridgeState('checking');
    setStatusText('Checking local hardware bridge...');
    setServiceError('');
    setErrorText('');

    try {
      // 1. Perform health check with bounded retry strategy
      const health = await checkBridgeHealthWithRetry({
        maxAttempts: 3,
        initialDelayMs: 350,
        backoffMultiplier: 1.8,
        onAttempt: (att, max) => {
          if (att > 1) {
            setStatusText(`Connecting to local hardware bridge (attempt ${att}/${max})...`);
          }
        },
      });

      if (!health.ready) {
        setBridgeState(health.state);
        setServiceReady(false);
        setServiceError(health.error || 'Local hardware bridge is unavailable.');
        setPorts([]);
        setSelectedPort('');
        setStatusText(health.error || 'Local hardware bridge is unavailable.');
        return;
      }

      setBridgeState('connected');
      setServiceReady(health.compilerReady);
      if (!health.compilerReady && health.error) {
        setServiceError(health.error);
      }

      // 2. Query available USB serial ports
      const portsResponse = await hardwareFetch('/flash/boards');
      if (!portsResponse.ok) throw new Error(await hardwareResponseError(portsResponse));
      const portPayload = await portsResponse.json() as { ports?: SerialPortInfo[] };
      const foundPorts = Array.isArray(portPayload.ports) ? portPayload.ports : [];
      setPorts(foundPorts);
      const recognizedPorts = foundPorts.filter((port) => port.fqbn && BOARD_OPTIONS.some((board) => board.fqbn === port.fqbn));
      const autoTargetPort = foundPorts.find((port) => port.port === selectedPort)
        || (foundPorts.length === 1 ? foundPorts[0] : recognizedPorts.length === 1 ? recognizedPorts[0] : null);

      setSelectedPort(autoTargetPort?.port || '');
      setSelectedBoard((previous) => {
        const detected = autoTargetPort?.fqbn;
        if (detected && BOARD_OPTIONS.some((board) => board.fqbn === detected)) return detected;
        return previous;
      });

      if (!health.compilerReady) {
        setStatusText('USB ports were scanned, but the Arduino compiler is not ready.');
      } else if (!foundPorts.length) {
        setStatusText('Local bridge connected. No USB serial board detected. Connect a data-capable cable and scan again.');
      } else if (foundPorts.length === 1) {
        const detectedBoard = foundPorts[0].board || 'USB serial device';
        setStatusText('Detected ' + detectedBoard + ' on ' + foundPorts[0].port + '.');
      } else {
        setStatusText('Detected ' + foundPorts.length + ' USB serial ports. Select the board port.');
      }
    } catch (error) {
      const message = describeHardwareConnectionError(error);
      setBridgeState('error');
      setServiceReady(false);
      setServiceError(message);
      setPorts([]);
      setSelectedPort('');
      setStatusText('Local hardware service is unavailable.');
    } finally {
      setStage((current) => current === 'detecting' ? 'idle' : current);
    }
  }, [selectedPort]);

  /* ── Unified refresh: try backend first, fall back to Web Serial ── */
  const refreshDevices = useCallback(async () => {
    if (mode === 'browser') {
      return refreshDevicesWebSerial();
    }
    try {
      await refreshDevicesBackend();
      setMode('local');
    } catch {
      // Backend unavailable — switch to browser Web Serial mode
      setMode('browser');
      await refreshDevicesWebSerial();
    }
  }, [mode, refreshDevicesBackend, refreshDevicesWebSerial]);

  /* ── Request a new device pairing (Web Serial browser picker) ── */
  const requestNewDevice = useCallback(async () => {
    if (!('serial' in navigator)) return;
    try {
      await (navigator as any).serial?.requestPort();
      // After user pairs, refresh to pick it up
      await refreshDevicesWebSerial();
    } catch {
      // user cancelled the picker
    }
  }, [refreshDevicesWebSerial]);

  useEffect(() => {
    void refreshDevices();
    return () => {
      serialControllerRef.current?.abort();
      // Cleanup Web Serial connections
      if (webSerialReaderRef.current) {
        webSerialReaderRef.current.cancel().catch(() => {});
        webSerialReaderRef.current = null;
      }
      if (webSerialWriterRef.current) {
        webSerialWriterRef.current.close().catch(() => {});
        webSerialWriterRef.current = null;
      }
      if (webSerialPortRef.current) {
        webSerialPortRef.current.close().catch(() => {});
        webSerialPortRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Bridge auto-polling: check if localhost:8000 comes online ── */
  useEffect(() => {
    if (mode !== 'browser') {
      if (bridgePollRef.current) { clearInterval(bridgePollRef.current); bridgePollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch('http://127.0.0.1:8000/flash/status', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          // Bridge came online! Switch to local mode
          setMode('local');
          setStatusText('Local bridge detected! Switching to full mode...');
          if (bridgePollRef.current) { clearInterval(bridgePollRef.current); bridgePollRef.current = null; }
          void refreshDevicesBackend().then(() => setMode('local')).catch(() => {});
        }
      } catch {
        // Still offline, keep polling
      }
    };
    bridgePollRef.current = setInterval(poll, 5000);
    return () => { if (bridgePollRef.current) { clearInterval(bridgePollRef.current); bridgePollRef.current = null; } };
  }, [mode, refreshDevicesBackend]);

  /* ── Auto-request bridge setup when board detected in browser mode ── */
  useEffect(() => {
    if (mode === 'browser' && ports.length > 0 && onRequestBridgeSetup && !bridgeSetupRunning) {
      // Board detected but no bridge — ask IDE to start bridge
      onRequestBridgeSetup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ports.length]);

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

  /* ── Compile (requires local backend) ── */
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
    if (mode === 'browser') {
      setErrorText('Compile requires the local hardware bridge.\n\nRun this command on your computer in the project folder:\n  npm run hardware:bridge\n\nThe browser can detect boards and monitor serial output, but compiling needs Arduino CLI running locally.');
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
  }, [code, currentBoard, mode]);

  /* ── Compile & Flash (requires local backend) ── */
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
    if (mode === 'browser') {
      setErrorText('Compile & Flash requires the local hardware bridge.\n\nRun this command on your computer in the project folder:\n  npm run hardware:bridge\n\nThe browser can detect boards and monitor serial output, but compiling and flashing needs Arduino CLI running locally.');
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
  }, [code, currentBoard, currentPort, mode]);

  /* ── Stop serial monitor (works for both modes) ── */
  const stopSerialMonitor = useCallback(async () => {
    serialControllerRef.current?.abort();
    serialControllerRef.current = null;
    // Close Web Serial connections
    if (webSerialReaderRef.current) {
      await webSerialReaderRef.current.cancel().catch(() => {});
      webSerialReaderRef.current.releaseLock();
      webSerialReaderRef.current = null;
    }
    if (webSerialWriterRef.current) {
      await webSerialWriterRef.current.close().catch(() => {});
      webSerialWriterRef.current = null;
    }
    if (webSerialPortRef.current) {
      await webSerialPortRef.current.close().catch(() => {});
      webSerialPortRef.current = null;
    }
    setStage('idle');
    setStatusText('Serial monitor stopped.');
  }, []);

  /* ── Start serial monitor via Web Serial API (browser-native) ── */
  const startSerialMonitorWebSerial = useCallback(async () => {
    if (!currentPort?._webSerialPort) {
      setErrorText('No Web Serial port reference. Try re-scanning USB devices.');
      setStage('error');
      return;
    }
    // Stop any existing monitor
    await stopSerialMonitor();

    const controller = new AbortController();
    serialControllerRef.current = controller;
    setSerialLines([]);
    setErrorText('');
    setStage('monitoring');
    setStatusText(`Opening Web Serial at ${baudRate} baud...`);

    const port = currentPort._webSerialPort;
    try {
      await port.open({ baudRate });
      webSerialPortRef.current = port;
      setStatusText(`Serial monitor connected via Web Serial at ${baudRate} baud.`);

      if (port.writable) {
        webSerialWriterRef.current = port.writable.getWriter();
      }

      if (!port.readable) throw new Error('Port is not readable.');
      const reader = port.readable.getReader();
      webSerialReaderRef.current = reader;
      const decoder = new TextDecoder();
      let lineBuffer = '';

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
          setSerialLines((prev) => [...prev.slice(-499), trimmed]);
        }
      }
      if (!controller.signal.aborted) {
        setStage('idle');
        setStatusText('Serial stream ended.');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const msg = error instanceof Error ? error.message : 'Could not open serial port.';
        if (msg.includes('already open') || msg.includes('locked')) {
          setErrorText('Serial port is already in use. Close other tabs or apps using this port, then try again.');
        } else {
          setErrorText(msg);
        }
        setStage('error');
        setStatusText('Could not open the serial monitor.');
      }
    } finally {
      if (serialControllerRef.current === controller) serialControllerRef.current = null;
    }
  }, [baudRate, currentPort, stopSerialMonitor]);

  /* ── Start serial monitor via local backend (SSE stream) ── */
  const startSerialMonitorBackend = useCallback(async () => {
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

  /* ── Unified serial monitor start ── */
  const startSerialMonitor = useCallback(async () => {
    if (!currentPort) {
      setErrorText('Select a detected USB serial port before opening the monitor.');
      setStage('error');
      return;
    }
    if (mode === 'browser' && currentPort._webSerialPort) {
      return startSerialMonitorWebSerial();
    }
    return startSerialMonitorBackend();
  }, [currentPort, mode, startSerialMonitorWebSerial, startSerialMonitorBackend]);

  /* ── Send serial data ── */
  const handleSendSerialCommand = useCallback(async () => {
    const text = serialInput.trim();
    if (!text || !currentPort || stage !== 'monitoring' || isSending) return;
    setIsSending(true);
    try {
      if (mode === 'browser' && webSerialWriterRef.current) {
        // Write directly via Web Serial API
        const encoder = new TextEncoder();
        await webSerialWriterRef.current.write(encoder.encode(text + '\n'));
        setSerialLines((lines) => [...lines.slice(-499), '> ' + text]);
        setSerialInput('');
      } else if (mode === 'local') {
        // Write via local backend
        const response = await hardwareFetch('/flash/serial-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: currentPort.port, text }),
        });
        if (!response.ok) throw new Error(await hardwareResponseError(response));
        setSerialLines((lines) => [...lines.slice(-499), '> ' + text]);
        setSerialInput('');
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not send serial data.');
    } finally {
      setIsSending(false);
    }
  }, [currentPort, isSending, mode, serialInput, stage]);

  const busy = stage === 'compiling' || stage === 'uploading' || stage === 'detecting';
  const hasFirmware = Boolean(code.trim());
  const canMonitor = Boolean(currentPort) && !busy;
  const canFlash = mode === 'local' && serviceReady && hasFirmware && Boolean(currentPort && currentBoard) && !busy;
  const deviceLabel = currentBoard?.name || currentPort?.board || currentPort?.product || 'USB serial device';

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.18 }}
      aria-label="USB board and firmware tools"
      className="absolute bottom-0 right-0 z-50 overflow-hidden border-t border-neutral-800 bg-[#090909] text-white shadow-2xl"
      style={{ left, height: stage === 'monitoring' ? '58vh' : 'min(420px, 58vh)' }}
    >
      <header className="flex h-10 items-center justify-between border-b border-neutral-800 bg-[#151515] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {currentPort ? <Cpu size={15} className="shrink-0 text-white" /> : <Usb size={15} className="shrink-0 text-neutral-300" />}
          <span className="shrink-0 text-xs font-semibold text-neutral-100">Hardware console</span>
          <span className="hidden h-4 w-px bg-neutral-700 sm:block" />
          <span className="truncate text-[11px] text-neutral-400">
            {currentPort
              ? `${deviceLabel} · ${currentPort.port}`
              : bridgeState === 'checking'
              ? 'Checking local bridge...'
              : bridgeState === 'permission-required'
              ? 'Browser permission required'
              : bridgeState === 'not-running'
              ? (mode === 'browser' ? 'Web Serial mode (Bridge offline)' : 'Local bridge offline')
              : serviceReady
              ? ports.length
                ? 'Select a detected serial port'
                : 'No board detected'
              : mode === 'browser'
              ? 'Web Serial mode'
              : 'Local USB service unavailable'}
          </span>
          <span
            className={
              'rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ' +
              (bridgeState === 'checking'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 animate-pulse'
                : currentPort
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : bridgeState === 'connected'
                ? 'border-emerald-600/30 bg-emerald-950/40 text-emerald-400'
                : bridgeState === 'permission-required'
                ? 'border-amber-500/40 bg-amber-900/30 text-amber-300'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400')
            }
          >
            {stage === 'compiling'
              ? 'Building'
              : stage === 'uploading'
              ? 'Uploading'
              : stage === 'monitoring'
              ? 'Monitoring'
              : stage === 'error'
              ? 'Error'
              : bridgeState === 'checking'
              ? 'Checking'
              : bridgeState === 'permission-required'
              ? 'Permission Required'
              : currentPort
              ? 'Connected'
              : bridgeState === 'connected'
              ? 'Bridge Ready'
              : mode === 'browser'
              ? 'Browser'
              : 'Offline'}
          </span>
          {mode === 'browser' && (
            <span className="flex items-center gap-1 rounded border border-green-900/50 bg-green-950/30 px-1.5 py-0.5 text-[9px] font-medium text-green-400">
              <Wifi size={9} /> Web Serial
            </span>
          )}
          {mode === 'local' && (
            <span className="flex items-center gap-1 rounded border border-blue-900/50 bg-blue-950/30 px-1.5 py-0.5 text-[9px] font-medium text-blue-400">
              <Wifi size={9} /> Local Bridge
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white" aria-label="Close board panel">
          <X size={15} />
        </button>
      </header>

      <div className="flex h-[calc(100%-40px)] min-h-0">
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-800 bg-[#111111] p-3">
          <div>
            <label htmlFor="hardware-port" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-400">USB serial port</label>
            <div className="flex gap-1.5">
              <select
                id="hardware-port"
                value={selectedPort}
                onChange={(event) => handlePortChange(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-[#0b0b0b] px-2 py-2 text-xs text-neutral-100 outline-none focus:border-neutral-300"
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
                onClick={() => mode === 'browser' ? void requestNewDevice() : void refreshDevices()}
                disabled={stage === 'detecting'}
                title={mode === 'browser' ? 'Pair a new USB device' : 'Scan USB ports'}
                aria-label={mode === 'browser' ? 'Pair a new USB device' : 'Scan USB ports'}
                className="rounded-md border border-neutral-700 bg-[#202020] p-2 text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={stage === 'detecting' ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="hardware-board" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-400">Board target</label>
            <select
              id="hardware-board"
              value={selectedBoard}
              onChange={(event) => handleBoardChange(event.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-[#0b0b0b] px-2 py-2 text-xs text-neutral-100 outline-none focus:border-neutral-300"
            >
              <option value="">Choose the exact board</option>
              {BOARD_OPTIONS.map((board) => <option key={board.fqbn} value={board.fqbn}>{board.name} - {board.family}</option>)}
            </select>
            {selectedBoard.startsWith('STMicroelectronics:') && <p className="mt-1.5 text-[10px] leading-4 text-neutral-300">Blue Pill needs a USB-to-UART adapter and an STM32 serial bootloader; the board itself has no USB serial interface.</p>}
          </div>

          <div>
            <label htmlFor="hardware-baud" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-400">Serial monitor baud</label>
            <select
              id="hardware-baud"
              value={baudRate}
              onChange={(event) => setBaudRate(Number(event.target.value))}
              className="w-full rounded-md border border-neutral-700 bg-[#0b0b0b] px-2 py-2 text-xs text-neutral-100 outline-none focus:border-neutral-300"
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
              title={mode === 'browser' ? 'Requires local hardware bridge (npm run hardware:bridge)' : undefined}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {stage === 'uploading' ? <Loader2 size={14} className="animate-spin" /> : stage === 'success' ? <Check size={14} /> : <Upload size={14} />}
              {stage === 'uploading' ? 'Compiling and uploading' : stage === 'success' ? 'Flash again' : 'Compile and flash'}
            </button>
            <button
              type="button"
              onClick={() => void handleCompile()}
              disabled={mode === 'browser' || !serviceReady || !hasFirmware || !currentBoard || busy}
              title={mode === 'browser' ? 'Requires local hardware bridge' : 'Compile without uploading'}
              className="rounded-md border border-neutral-700 bg-[#202020] px-3 py-2 text-xs font-medium text-neutral-200 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Build
            </button>
          </div>

          <button
            type="button"
            onClick={() => stage === 'monitoring' ? void stopSerialMonitor() : void startSerialMonitor()}
            disabled={!canMonitor}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-700 bg-[#202020] px-3 py-2 text-xs font-medium text-neutral-200 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {stage === 'monitoring' ? <Square size={13} /> : <Terminal size={13} />}
            {stage === 'monitoring' ? 'Stop serial monitor' : 'Open serial monitor'}
          </button>

          <div className="mt-auto border-t border-neutral-800 pt-2 text-[10px] leading-4 text-neutral-400">
            {statusText}
            {currentPort && <div className="mt-1 font-mono text-neutral-500">USB ID: {currentPort.vid_pid || 'Not reported'} · S/N: {currentPort.serial_number || 'Not reported by device'}</div>}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0e13]">
          {busy && <div className="h-0.5 w-full overflow-hidden bg-neutral-800"><motion.div className="h-full w-1/3 bg-neutral-100" animate={{ x: ['-100%', '300%'] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} /></div>}
          {mode === 'browser' && !errorText && stage !== 'monitoring' && (
            <div className="m-3 rounded-lg border border-neutral-800 bg-[#0c0c0c] overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-neutral-800 bg-[#141414] px-4 py-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-green-950 border border-green-900/50">
                  <Wifi size={12} className="text-green-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-neutral-100">Hardware Bridge Setup</div>
                  <div className="text-[10px] text-neutral-500">Auto-detecting compile service...</div>
                </div>
              </div>
              <div className="p-3 space-y-2.5">
                {/* Step 1: Board Detection */}
                <div className="flex items-start gap-2.5">
                  <div className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' + (currentPort ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-neutral-800 text-neutral-500 border border-neutral-700')}>
                    {currentPort ? '✓' : '1'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={'text-xs font-medium ' + (currentPort ? 'text-green-400' : 'text-neutral-300')}>
                      {currentPort ? `${deviceLabel} detected` : 'Detect USB board'}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {currentPort ? `Port: ${currentPort.port} · USB ID: ${currentPort.vid_pid || 'N/A'}` : 'Connect a board and pair it via the browser'}
                    </div>
                  </div>
                </div>
                {/* Step 2: Serial Monitor */}
                <div className="flex items-start gap-2.5">
                  <div className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' + (currentPort ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-neutral-800 text-neutral-500 border border-neutral-700')}>
                    {currentPort ? '✓' : '2'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={'text-xs font-medium ' + (currentPort ? 'text-green-400' : 'text-neutral-400')}>Serial monitor ready</div>
                    <div className="text-[10px] text-neutral-500">Direct browser connection · No bridge needed</div>
                  </div>
                </div>
                {/* Step 3: Compile Bridge */}
                <div className="flex items-start gap-2.5">
                  <div className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' + (bridgeSetupRunning ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-neutral-800 text-neutral-500 border border-neutral-700')}>
                    {bridgeSetupRunning ? <Loader2 size={10} className="animate-spin" /> : '3'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={'text-xs font-medium ' + (bridgeSetupRunning ? 'text-amber-400' : 'text-neutral-400')}>
                      {bridgeSetupRunning ? 'Starting compile service...' : 'Compile & Flash service'}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {bridgeSetupRunning
                        ? 'Running npm run hardware:bridge in terminal...'
                        : 'Waiting for local Arduino CLI bridge on :8000'}
                    </div>
                    {!bridgeSetupRunning && onRequestBridgeSetup && (
                      <button
                        type="button"
                        onClick={onRequestBridgeSetup}
                        className="mt-1.5 flex items-center gap-1.5 rounded-md border border-neutral-700 bg-[#1a1a1a] px-2.5 py-1.5 text-[10px] font-medium text-neutral-200 hover:border-neutral-500 hover:text-white transition-colors"
                      >
                        <Terminal size={10} /> Start bridge via terminal
                      </button>
                    )}
                    {!onRequestBridgeSetup && (
                      <div className="mt-1.5 rounded-md bg-black/50 px-2.5 py-1.5 font-mono text-[10px] text-neutral-400 select-all cursor-text">
                        npm run hardware:bridge
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-neutral-800 bg-[#0a0a0a] px-4 py-2 text-[10px] text-neutral-500">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                Auto-polling bridge every 5s — will auto-connect when ready
              </div>
            </div>
          )}
          {mode === 'local' && bridgeState !== 'connected' && stage !== 'compiling' && stage !== 'uploading' && (
            <div className="m-3 rounded-lg border border-neutral-700 bg-neutral-900/90 p-4 text-xs text-neutral-200 shadow-xl">
              <div className="flex items-center justify-between gap-3 pb-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <AlertTriangle size={16} className={bridgeState === 'permission-required' || bridgeState === 'cors-rejected' ? 'text-amber-400' : 'text-neutral-400'} />
                  {bridgeState === 'checking'
                    ? 'Checking local hardware bridge'
                    : hostedProduction
                    ? 'Secure hardware bridge not connected'
                    : bridgeState === 'permission-required'
                    ? 'Browser permission required'
                    : bridgeState === 'cors-rejected'
                    ? 'Origin not authorized by bridge'
                    : bridgeState === 'not-running'
                    ? 'Local hardware bridge is not running'
                    : 'Local hardware bridge connection issue'}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshDevices()}
                  disabled={stage === 'detecting'}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={stage === 'detecting' ? 'animate-spin' : ''} />
                  Retry connection
                </button>
              </div>

              <p className="mt-1 text-neutral-300 leading-relaxed">{serviceError || statusText}</p>

              {hostedProduction && (
                <div className="mt-3 rounded border border-blue-500/30 bg-blue-500/10 p-3 text-[11px] text-blue-100 leading-relaxed">
                  <div className="font-semibold text-blue-200 mb-2">Connect this computer without browser local-network permission</div>
                  <p>The paired agent makes an outbound encrypted connection and can compile and flash boards plugged into that computer. Pairing is required once per computer.</p>
                  <button
                    type="button"
                    onClick={() => void setupCloudBridge()}
                    disabled={cloudSetupBusy}
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60"
                  >
                    {cloudSetupBusy ? <Loader2 size={13} className="animate-spin" /> : <Usb size={13} />}
                    {cloudSetupBusy ? 'Preparing pairing…' : 'Pair computer and download setup file'}
                  </button>
                  {pairedBridgeId && (
                    <button
                      type="button"
                      onClick={() => void revokeCloudBridge()}
                      disabled={cloudSetupBusy}
                      className="ml-2 rounded-md border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/10 disabled:opacity-60"
                    >
                      Revoke paired computer
                    </button>
                  )}
                  {cloudSetupMessage && (
                    <p role="status" className="mt-2 whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[10px] text-blue-100">{cloudSetupMessage}</p>
                  )}
                </div>
              )}

              {!hostedProduction && bridgeState === 'permission-required' && (
                <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 leading-relaxed">
                  <div className="font-semibold text-amber-300 mb-1">Granting local access in Google Chrome / Microsoft Edge:</div>
                  <ol className="list-decimal list-inside space-y-1 text-amber-200/90">
                    <li>Click the <strong>tune / sliders icon</strong> (or lock icon) on the left of the address bar next to <code className="rounded bg-black/60 px-1 py-0.5 font-mono text-amber-300">final-kaktus.vercel.app</code>.</li>
                    <li>Look for <strong>Apps on device</strong> (or open <strong>Site settings</strong> &gt; <strong>Local network access</strong>).</li>
                    <li>Change the setting from <em>Block</em> to <strong>Allow</strong>.</li>
                    <li>Ensure the bridge is running locally with <code className="rounded bg-black/60 px-1 py-0.5 font-mono text-amber-300">npm run hardware:bridge</code>, then click <strong>Retry connection</strong> above.</li>
                  </ol>
                </div>
              )}

              {bridgeState === 'cors-rejected' && (
                <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200 leading-relaxed">
                  <div className="font-semibold text-red-300 mb-1">Origin Not Authorized:</div>
                  <p>The local bridge is running, but rejected requests from this domain for security.</p>
                  <p className="mt-1">Add <code className="rounded bg-black/60 px-1 py-0.5 font-mono text-red-300">https://final-kaktus.vercel.app</code> to <code className="rounded bg-black/60 px-1 py-0.5 font-mono text-red-300">KAKTUS_WEB_ORIGINS</code> in your <code className="rounded bg-black/60 px-1 py-0.5 font-mono text-red-300">.env.local</code> file and restart the bridge.</p>
                </div>
              )}

              {bridgeState === 'not-running' && (
                <div className="mt-3 space-y-2 rounded border border-neutral-800 bg-black/50 p-3 text-[11px] text-neutral-300">
                  <div className="font-medium text-neutral-200">Starting the local hardware bridge:</div>
                  <p className="text-neutral-400">Run this command in your project terminal:</p>
                  <code className="block rounded bg-neutral-950 p-2 font-mono text-xs text-emerald-400 border border-neutral-800">
                    npm run hardware:bridge
                  </code>
                  <p className="text-neutral-400 pt-1">
                    To automatically start the bridge on Windows login (user-level, no admin required):
                  </p>
                  <code className="block rounded bg-neutral-950 p-2 font-mono text-xs text-neutral-300 border border-neutral-800">
                    npm run hardware:autostart:enable
                  </code>
                </div>
              )}
            </div>
          )}
          {serviceError && serviceReady && (
            <div className="m-3 rounded-md border border-neutral-700 bg-neutral-900/70 p-3 text-xs text-neutral-200">
              <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> Compiler note</div>
              <p className="mt-1 text-neutral-300">{serviceError}</p>
            </div>
          )}
          {errorText && (
            <div className="m-3 flex min-h-0 flex-col rounded-md border border-neutral-700 bg-neutral-900/50 p-3 text-xs text-neutral-200">
              <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> {stage === 'error' ? 'Operation failed' : 'Serial write failed'}</div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-neutral-300">{errorText}</pre>
            </div>
          )}
          {stage === 'success' && !errorText && (
            <div className="flex items-center gap-2 border-b border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100">
              <CheckCircle2 size={15} /> Firmware upload completed on {currentPort?.port}.
            </div>
          )}
          {compileOutput && !errorText && stage !== 'monitoring' && (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-neutral-300">{compileOutput}</pre>
          )}
          {stage === 'monitoring' && !errorText && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-9 items-center justify-between border-b border-neutral-800 px-3 text-[11px] text-neutral-400">
                <span className="flex items-center gap-2"><MonitorSpeaker size={13} /> {currentPort?.port} · {baudRate} baud {mode === 'browser' && <span className="text-green-400">(Web Serial)</span>}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} /> Auto-scroll</label>
                  <button type="button" onClick={() => setSerialLines([])} className="hover:text-white">Clear</button>
                  <span>{serialLines.length} lines</span>
                </div>
              </div>
              <div ref={serialContainerRef} className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5 text-neutral-300">
                {serialLines.length ? serialLines.map((line, index) => <div key={index} className="whitespace-pre-wrap">{line}</div>) : <p className="text-neutral-600">Connected. Waiting for serial data.</p>}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void handleSendSerialCommand(); }} className="flex h-10 items-center gap-2 border-t border-neutral-800 bg-[#111111] px-3">
                <span className="font-mono text-neutral-500">&gt;</span>
                <input value={serialInput} onChange={(event) => setSerialInput(event.target.value)} placeholder="Send text to the board" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-neutral-600" />
                <button type="submit" disabled={!serialInput.trim() || isSending} className="flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-[11px] font-medium text-black hover:bg-neutral-200 disabled:opacity-40">{isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send</button>
              </form>
            </div>
          )}
          {!errorText && !compileOutput && stage !== 'monitoring' && (
            <div className="flex flex-1 flex-col items-center justify-center p-5 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-[#141414]">
                {currentPort ? <Cpu size={21} className="text-white" /> : <Usb size={21} className="text-neutral-400" />}
              </div>
              {stage === 'success' ? (
                <>
                  <CheckCircle2 size={19} className="mb-2 text-white" />
                  <h2 className="text-sm font-semibold text-neutral-100">Upload complete</h2>
                  <p className="mt-1 max-w-lg text-xs text-neutral-400">Firmware was uploaded to {currentBoard?.name} on {currentPort?.port}. Open the serial monitor to confirm the board&apos;s output.</p>
                </>
              ) : currentPort ? (
                <>
                  <h2 className="text-sm font-semibold text-neutral-100">{deviceLabel} connected</h2>
                  <p className="mt-1 max-w-lg font-mono text-xs text-neutral-400">{currentPort.port} · {currentBoard ? currentBoard.chip + ' · ' + currentBoard.fqbn : 'Choose the exact board target in the left panel.'}</p>
                  <p className="mt-1 max-w-lg text-[11px] text-neutral-500">{currentPort.description || currentPort.product || 'USB serial device'}{currentPort.vid_pid ? ' · USB ID ' + currentPort.vid_pid : ''}</p>
                  {currentPort.serial_number && <p className="mt-1 font-mono text-[10px] text-neutral-500">S/N {currentPort.serial_number}</p>}
                  {!hasFirmware && <p className="mt-3 text-[11px] text-neutral-400">Serial Monitor is ready. Open Code Preview on a circuit step to enable Build and Flash.</p>}
                </>
              ) : (
                <>
                  <h2 className="text-sm font-semibold text-neutral-100">Connect a microcontroller over USB</h2>
                  <p className="mt-1 max-w-lg text-xs text-neutral-400">
                    {mode === 'browser'
                      ? 'Click the refresh button to pair a USB device from your browser. Your board will be auto-identified.'
                      : 'Connect a data-capable cable. The local bridge scans serial ports and fills in the board identity when its USB descriptor is known.'}
                  </p>
                </>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[10px] text-neutral-400">
                <span className="rounded border border-neutral-800 px-2 py-1">Arduino Uno / Nano / Mega</span>
                <span className="rounded border border-neutral-800 px-2 py-1">ESP32 / S3 / C3</span>
                <span className="rounded border border-neutral-800 px-2 py-1">RP2040 Pico</span>
                <span className="rounded border border-neutral-800 px-2 py-1">STM32 Blue Pill with UART bootloader</span>
              </div>
              {!currentPort && ports.length > 0 && <p className="mt-3 text-xs text-neutral-300">Choose a serial port from the left panel. Some boards do not report a USB serial number.</p>}
            </div>
          )}
        </main>
      </div>
    </motion.section>
  );
}
