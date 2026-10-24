'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, X, Zap, ChevronRight, Unplug, Wifi } from 'lucide-react';

/* ── Known USB Vendor/Product IDs to Board Mapping ───────────────── */
interface KnownBoard {
  name: string;
  chip: string;
  fqbn: string;
  defaultBaud: number;
  family: string;
}

const USB_VID_PID_MAP: Record<string, KnownBoard> = {
  // Arduino Uno / Nano / Mega (CH340)
  '0x1A86:0x7523': { name: 'Arduino (CH340)', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: 'AVR' },
  // Arduino Uno / Nano (FTDI FT232R)
  '0x0403:0x6001': { name: 'Arduino (FTDI)', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: 'AVR' },
  // Arduino Uno Rev3 (ATmega16U2)
  '0x2341:0x0043': { name: 'Arduino Uno', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: 'AVR' },
  '0x2341:0x0001': { name: 'Arduino Uno', chip: 'ATmega328P', fqbn: 'arduino:avr:uno', defaultBaud: 9600, family: 'AVR' },
  // Arduino Mega 2560
  '0x2341:0x0010': { name: 'Arduino Mega 2560', chip: 'ATmega2560', fqbn: 'arduino:avr:mega', defaultBaud: 9600, family: 'AVR' },
  '0x2341:0x0042': { name: 'Arduino Mega 2560', chip: 'ATmega2560', fqbn: 'arduino:avr:mega', defaultBaud: 9600, family: 'AVR' },
  // Arduino Nano (new bootloader)
  '0x2341:0x0058': { name: 'Arduino Nano', chip: 'ATmega328P', fqbn: 'arduino:avr:nano', defaultBaud: 9600, family: 'AVR' },
  // Arduino Leonardo / Pro Micro
  '0x2341:0x8036': { name: 'Arduino Leonardo', chip: 'ATmega32U4', fqbn: 'arduino:avr:leonardo', defaultBaud: 9600, family: 'AVR' },
  // CP2102 (common ESP32 boards)
  '0x10C4:0xEA60': { name: 'ESP32 (CP2102)', chip: 'ESP32', fqbn: 'esp32:esp32:esp32', defaultBaud: 115200, family: 'Wireless MCU' },
  // CP2104
  '0x10C4:0xEA70': { name: 'ESP32 (CP2104)', chip: 'ESP32', fqbn: 'esp32:esp32:esp32', defaultBaud: 115200, family: 'Wireless MCU' },
  // ESP32-S2 native USB
  '0x303A:0x0002': { name: 'ESP32-S2', chip: 'ESP32-S2', fqbn: 'esp32:esp32:esp32s2', defaultBaud: 115200, family: 'Wireless MCU' },
  // ESP32-S3 native USB
  '0x303A:0x1001': { name: 'ESP32-S3', chip: 'ESP32-S3', fqbn: 'esp32:esp32:esp32s3', defaultBaud: 115200, family: 'Wireless MCU' },
  // ESP32-C3 native USB
  '0x303A:0x1002': { name: 'ESP32-C3', chip: 'ESP32-C3 RISC-V', fqbn: 'esp32:esp32:esp32c3', defaultBaud: 115200, family: 'RISC-V MCU' },
  // Raspberry Pi Pico
  '0x2E8A:0x0005': { name: 'Raspberry Pi Pico', chip: 'RP2040', fqbn: 'rp2040:rp2040:pico', defaultBaud: 115200, family: 'Cortex-M0+' },
  '0x2E8A:0x000A': { name: 'Raspberry Pi Pico W', chip: 'RP2040', fqbn: 'rp2040:rp2040:pico', defaultBaud: 115200, family: 'Cortex-M0+' },
  // STM32 (ST-Link / DFU)
  '0x0483:0x5740': { name: 'STM32 (Virtual COM)', chip: 'STM32', fqbn: 'STMicroelectronics:stm32:GenF1', defaultBaud: 115200, family: 'Cortex-M' },
};

function identifyBoard(port: SerialPort): KnownBoard | null {
  const info = port.getInfo();
  if (!info.usbVendorId || !info.usbProductId) return null;
  const vid = '0x' + info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
  const pid = '0x' + info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
  return USB_VID_PID_MAP[`${vid}:${pid}`] || null;
}

function getPortLabel(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId && info.usbProductId) {
    const vid = '0x' + info.usbVendorId.toString(16).toUpperCase().padStart(4, '0');
    const pid = '0x' + info.usbProductId.toString(16).toUpperCase().padStart(4, '0');
    return `${vid}:${pid}`;
  }
  return 'Unknown Port';
}

/* ── Exported detected device type ───────────────────────────────── */
export interface WebSerialDevice {
  port: SerialPort;
  board: KnownBoard | null;
  label: string;
}

/* ── Component Props ─────────────────────────────────────────────── */
interface UsbAutoDetectProps {
  onDeviceConnected: (device: WebSerialDevice) => void;
  isFlashOpen: boolean;
}

/* ── Main Component ──────────────────────────────────────────────── */
export function UsbAutoDetect({ onDeviceConnected, isFlashOpen }: UsbAutoDetectProps) {
  const [notification, setNotification] = useState<WebSerialDevice | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);
  const knownPortsRef = useRef<Set<SerialPort>>(new Set());

  // Check Web Serial API support
  useEffect(() => {
    setIsSupported('serial' in navigator);
  }, []);

  // Handle new port connection
  const handleConnect = useCallback((event: Event) => {
    const port = (event as any).target as SerialPort;
    if (knownPortsRef.current.has(port)) return;
    knownPortsRef.current.add(port);

    const board = identifyBoard(port);
    const label = getPortLabel(port);
    const device: WebSerialDevice = { port, board, label };

    setNotification(device);
    setDismissed(false);
    setDisconnectNotice(null);
  }, []);

  // Handle port disconnection
  const handleDisconnect = useCallback((event: Event) => {
    const port = (event as any).target as SerialPort;
    knownPortsRef.current.delete(port);

    const board = identifyBoard(port);
    const name = board?.name || 'USB Device';
    setDisconnectNotice(`${name} disconnected`);
    setTimeout(() => setDisconnectNotice(null), 4000);

    // If the disconnected device is the one we're showing, dismiss it
    if (notification?.port === port) {
      setNotification(null);
    }
  }, [notification]);

  // Set up Web Serial API listeners
  useEffect(() => {
    if (!isSupported) return;

    navigator.serial.addEventListener('connect', handleConnect);
    navigator.serial.addEventListener('disconnect', handleDisconnect);

    // Check for already-authorized ports on mount
    navigator.serial.getPorts().then(ports => {
      for (const port of ports) {
        knownPortsRef.current.add(port);
      }
      // Show notification for first already-connected device if FlashPanel is not open
      if (ports.length > 0 && !isFlashOpen) {
        const firstPort = ports[0];
        const board = identifyBoard(firstPort);
        const label = getPortLabel(firstPort);
        setNotification({ port: firstPort, board, label });
        setDismissed(false);
      }
    });

    return () => {
      navigator.serial.removeEventListener('connect', handleConnect);
      navigator.serial.removeEventListener('disconnect', handleDisconnect);
    };
  }, [isSupported, handleConnect, handleDisconnect, isFlashOpen]);

  // Auto-dismiss when FlashPanel opens
  useEffect(() => {
    if (isFlashOpen && notification) setDismissed(true);
  }, [isFlashOpen, notification]);

  const handleOpenConsole = () => {
    if (notification) {
      onDeviceConnected(notification);
      setDismissed(true);
    }
  };

  // Request permission for a new device (needed for first-time access)
  const handleRequestDevice = async () => {
    if (!isSupported) return;
    try {
      const port = await navigator.serial.requestPort();
      knownPortsRef.current.add(port);
      const board = identifyBoard(port);
      const label = getPortLabel(port);
      const device: WebSerialDevice = { port, board, label };
      setNotification(device);
      setDismissed(false);
      onDeviceConnected(device);
    } catch {
      // User cancelled the prompt
    }
  };

  const showNotification = notification && !dismissed && !isFlashOpen;
  const deviceName = notification?.board?.name || 'USB Serial Device';
  const chipName = notification?.board?.chip || '';
  const baudRate = notification?.board?.defaultBaud || 9600;
  const familyName = notification?.board?.family || '';

  return (
    <>
      {/* ── Connected Device Notification ─────────────────────────── */}
      <AnimatePresence>
        {showNotification && (
          <motion.div
            initial={{ y: 100, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 100, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[440px] max-w-[calc(100vw-32px)]"
          >
            <div className="bg-[#0d0d0d] border border-neutral-700/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden backdrop-blur-xl">
              {/* Green accent bar */}
              <div className="h-[3px] bg-gradient-to-r from-green-500 via-emerald-400 to-teal-500" />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-500/15 border border-green-500/25">
                      <Cpu size={22} className="text-green-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">{deviceName}</h4>
                        <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                          Connected
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        {chipName && `${chipName} · `}{baudRate} baud{familyName && ` · ${familyName}`}
                      </p>
                      <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
                        USB ID: {notification?.label}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDismissed(true)}
                    className="rounded-lg p-1 text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <button
                  onClick={handleOpenConsole}
                  className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-neutral-200 active:scale-[0.98] text-black text-xs font-semibold py-2.5 transition-all duration-200"
                >
                  <Zap size={14} />
                  Open Hardware Console
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Disconnect Toast ──────────────────────────────────────── */}
      <AnimatePresence>
        {disconnectNotice && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]"
          >
            <div className="flex items-center gap-2.5 bg-[#1a1a1a] border border-red-900/40 rounded-xl px-4 py-3 text-xs text-red-300 shadow-xl">
              <Unplug size={15} className="text-red-400" />
              {disconnectNotice}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating "Pair Device" button (when no device is connected and panel is closed) ── */}
      <AnimatePresence>
        {isSupported && !isFlashOpen && knownPortsRef.current.size === 0 && !notification && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0.3 }}
            onClick={handleRequestDevice}
            className="fixed bottom-6 right-6 z-[9998] flex items-center gap-2 bg-[#1a1a1a] hover:bg-[#252525] border border-neutral-700 rounded-full px-4 py-2.5 text-xs font-medium text-neutral-300 hover:text-white shadow-xl transition-all hover:scale-105 active:scale-95"
            title="Connect a microcontroller via USB"
          >
            <Wifi size={14} className="text-blue-400" />
            Pair USB Device
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
