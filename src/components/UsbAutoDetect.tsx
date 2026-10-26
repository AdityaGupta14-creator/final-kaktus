'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Unplug } from 'lucide-react';

/* ── Known USB Vendor/Product IDs → Board Mapping ────────────────── */
interface KnownBoard {
  name: string;
  chip: string;
  fqbn: string;
  defaultBaud: number;
  family: string;
}

interface BrowserSerialPort {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface BrowserSerialApi {
  getPorts(): Promise<BrowserSerialPort[]>;
  requestPort(): Promise<BrowserSerialPort>;
  addEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: EventListener): void;
}

function getBrowserSerialApi(): BrowserSerialApi | null {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return null;
  return (navigator as Navigator & { serial: BrowserSerialApi }).serial;
}

const USB_VID_PID_MAP: Record<string, KnownBoard> = {
  '0x2341:0x0043': { name: 'Arduino Uno', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x0001': { name: 'Arduino Uno', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x0010': { name: 'Arduino Mega 2560', chip: 'ATmega2560', fqbn: 'arduino:avr:mega', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x0042': { name: 'Arduino Mega 2560', chip: 'ATmega2560', fqbn: 'arduino:avr:mega', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x0036': { name: 'Arduino Leonardo', chip: 'ATmega32U4', fqbn: 'arduino:avr:leonardo', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x8036': { name: 'Arduino Leonardo', chip: 'ATmega32U4', fqbn: 'arduino:avr:leonardo', defaultBaud: 9600, family: '8-bit AVR' },
  '0x2341:0x0058': { name: 'Arduino Nano Every', chip: 'ATmega4809', fqbn: 'arduino:megaavr:nona4809', defaultBaud: 9600, family: '8-bit AVR' },
};

const USB_DEVICE_LABELS: Record<string, string> = {
  '0x1A86:0x7523': 'CH340 USB-to-serial adapter',
  '0x1A86:0x55D4': 'CH9102 USB-to-serial adapter',
  '0x0403:0x6001': 'FTDI USB-to-serial adapter',
  '0x10C4:0xEA60': 'CP210x USB-to-serial adapter',
  '0x10C4:0xEA70': 'CP210x USB-to-serial adapter',
  '0x303A:0x0002': 'Espressif USB Serial/JTAG device — select the exact board',
  '0x303A:0x1001': 'Espressif USB Serial/JTAG device — select the exact board',
  '0x2E8A:0x000A': 'RP2040 USB device — select the exact board',
  '0x2E8A:0xF00A': 'RP2040 USB device — select the exact board',
  '0x0483:0x5740': 'STMicroelectronics virtual COM port',
};

function identifyBoard(port: BrowserSerialPort): KnownBoard | null {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return null;
  const vid = '0x' + info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
  const pid = '0x' + info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
  return USB_VID_PID_MAP[`${vid}:${pid}`] || null;
}

function getVidPid(port: BrowserSerialPort): string {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return '';
  return '0x' + info.usbVendorId.toString(16).toUpperCase().padStart(4, '0') + ':0x' + info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
}

function identifyUsbLabel(port: BrowserSerialPort): string | null {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return null;
  const vid = '0x' + info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
  const pid = '0x' + info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
  return USB_DEVICE_LABELS[`${vid}:${pid}`] || null;
}

/* ── Exported types ──────────────────────────────────────────────── */
export interface WebSerialDevice {
  port: BrowserSerialPort;
  board: KnownBoard | null;
  usbLabel: string | null;
  vidPid: string;
}

interface UsbAutoDetectProps {
  /** Called when a device is auto-detected or user pairs one. Opens FlashPanel. */
  onDeviceConnected: (device: WebSerialDevice) => void;
  /** True when FlashPanel is already open (suppress duplicate notifications) */
  isFlashOpen: boolean;
}

/* ── Component ───────────────────────────────────────────────────── */
export function UsbAutoDetect({ onDeviceConnected, isFlashOpen }: UsbAutoDetectProps) {
  const [toast, setToast] = useState<{ message: string; type: 'connect' | 'disconnect' } | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const knownPortsRef = useRef<Set<BrowserSerialPort>>(new Set());
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Show a toast for a few seconds
  const showToast = useCallback((message: string, type: 'connect' | 'disconnect') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    setIsSupported(getBrowserSerialApi() !== null);
  }, []);

  // Auto-detect already-authorized ports on mount (no popup needed!)
  useEffect(() => {
    const serialApi = getBrowserSerialApi();
    if (!isSupported || !serialApi) return;

    serialApi.getPorts().then(ports => {
      for (const port of ports) {
        knownPortsRef.current.add(port);
      }
      // If there are already connected boards and FlashPanel is not open, notify
      if (ports.length > 0 && !isFlashOpen) {
        const port = ports[0];
        const board = identifyBoard(port);
        const usbLabel = identifyUsbLabel(port);
        const name = board?.name || usbLabel || 'USB Device';
        showToast(`${name} detected & connected automatically`, 'connect');
        onDeviceConnected({ port, board, usbLabel, vidPid: getVidPid(port) });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported]);

  // Listen for connect/disconnect events (fires automatically for authorized devices)
  useEffect(() => {
    const serialApi = getBrowserSerialApi();
    if (!isSupported || !serialApi) return;

    const onConnect = (e: Event) => {
      const port = (e as any).target as BrowserSerialPort;
      if (knownPortsRef.current.has(port)) return;
      knownPortsRef.current.add(port);
      const board = identifyBoard(port);
      const usbLabel = identifyUsbLabel(port);
      const name = board?.name || usbLabel || 'USB Device';
      showToast(`${name} detected & connected`, 'connect');
      if (!isFlashOpen) {
        onDeviceConnected({ port, board, usbLabel, vidPid: getVidPid(port) });
      }
    };

    const onDisconnect = (e: Event) => {
      const port = (e as any).target as BrowserSerialPort;
      knownPortsRef.current.delete(port);
      const board = identifyBoard(port);
      const usbLabel = identifyUsbLabel(port);
      const name = board?.name || usbLabel || 'USB Device';
      showToast(`${name} disconnected`, 'disconnect');
    };

    serialApi.addEventListener('connect', onConnect);
    serialApi.addEventListener('disconnect', onDisconnect);
    return () => {
      serialApi.removeEventListener('connect', onConnect);
      serialApi.removeEventListener('disconnect', onDisconnect);
    };
  }, [isSupported, isFlashOpen, onDeviceConnected, showToast]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 80, opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999]"
        >
          <div className={
            'flex items-center gap-3 rounded-xl border px-5 py-3 shadow-2xl backdrop-blur-md text-sm font-medium ' +
            (toast.type === 'connect'
              ? 'bg-[#0d1a0d] border-green-800/50 text-green-300'
              : 'bg-[#1a0d0d] border-red-800/50 text-red-300')
          }>
            {toast.type === 'connect'
              ? <Cpu size={18} className="text-green-400 shrink-0" />
              : <Unplug size={18} className="text-red-400 shrink-0" />
            }
            {toast.message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Call this from the "Connect" button's onClick handler.
 * It opens the browser's serial port picker (required by browser security for first-time access).
 * Once the user selects a port, subsequent connections from the same device are fully automatic.
 */
export async function requestSerialDevice(): Promise<WebSerialDevice | null> {
  const serialApi = getBrowserSerialApi();
  if (!serialApi) return null;
  try {
    const port = await serialApi.requestPort();
    const board = identifyBoard(port);
    return { port, board, usbLabel: identifyUsbLabel(port), vidPid: getVidPid(port) };
  } catch {
    return null; // user cancelled
  }
}
