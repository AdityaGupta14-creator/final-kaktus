'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Usb, X, Zap, ChevronRight } from 'lucide-react';
import { hardwareFetch, describeHardwareConnectionError, hardwareResponseError } from '@/lib/hardware-api';
import { BOARD_OPTIONS, type BoardOption } from '@/components/FlashPanel';

interface DetectedDevice {
  port: string;
  board: string | null;
  fqbn: string | null;
  chip: string | null;
  defaultBaud: number;
  product: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  vid_pid: string | null;
  boardOption: BoardOption | null;
}

interface UsbAutoDetectProps {
  onDeviceConnected: (device: DetectedDevice) => void;
  isFlashOpen: boolean;
}

const POLL_INTERVAL = 3000; // 3 seconds

export function UsbAutoDetect({ onDeviceConnected, isFlashOpen }: UsbAutoDetectProps) {
  const [notification, setNotification] = useState<DetectedDevice | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [serviceOnline, setServiceOnline] = useState(false);
  const knownPortsRef = useRef<Set<string>>(new Set());
  const initialScanDone = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scanPorts = useCallback(async () => {
    try {
      const response = await hardwareFetch('/flash/boards');
      if (!response.ok) return;
      const payload = await response.json() as { ports?: Array<{
        port: string;
        board?: string | null;
        fqbn?: string | null;
        product?: string | null;
        manufacturer?: string | null;
        serial_number?: string | null;
        vid_pid?: string | null;
      }> };
      const foundPorts = Array.isArray(payload.ports) ? payload.ports : [];
      setServiceOnline(true);

      const currentPorts = new Set(foundPorts.map(p => p.port));

      // After initial scan, detect NEW devices
      if (initialScanDone.current) {
        for (const portInfo of foundPorts) {
          if (!knownPortsRef.current.has(portInfo.port)) {
            // New device detected!
            const matchedBoard = portInfo.fqbn
              ? BOARD_OPTIONS.find(b => b.fqbn === portInfo.fqbn)
              : null;

            const device: DetectedDevice = {
              port: portInfo.port,
              board: portInfo.board || matchedBoard?.name || null,
              fqbn: portInfo.fqbn || matchedBoard?.fqbn || null,
              chip: matchedBoard?.chip || null,
              defaultBaud: matchedBoard?.defaultBaud || 9600,
              product: portInfo.product || null,
              manufacturer: portInfo.manufacturer || null,
              serial_number: portInfo.serial_number || null,
              vid_pid: portInfo.vid_pid || null,
              boardOption: matchedBoard || null,
            };

            setNotification(device);
            setDismissed(false);
          }
        }
      } else {
        // First scan: just record existing ports, don't notify
        initialScanDone.current = true;
        // But if there are already devices connected, show for the first one
        if (foundPorts.length > 0 && !isFlashOpen) {
          const firstPort = foundPorts[0];
          const matchedBoard = firstPort.fqbn
            ? BOARD_OPTIONS.find(b => b.fqbn === firstPort.fqbn)
            : null;

          const device: DetectedDevice = {
            port: firstPort.port,
            board: firstPort.board || matchedBoard?.name || null,
            fqbn: firstPort.fqbn || matchedBoard?.fqbn || null,
            chip: matchedBoard?.chip || null,
            defaultBaud: matchedBoard?.defaultBaud || 9600,
            product: firstPort.product || null,
            manufacturer: firstPort.manufacturer || null,
            serial_number: firstPort.serial_number || null,
            vid_pid: firstPort.vid_pid || null,
            boardOption: matchedBoard || null,
          };

          setNotification(device);
          setDismissed(false);
        }
      }

      knownPortsRef.current = currentPorts;
    } catch {
      // Service offline, silently ignore
      setServiceOnline(false);
    }
  }, [isFlashOpen]);

  // Start background polling
  useEffect(() => {
    // Initial scan
    void scanPorts();

    pollTimerRef.current = setInterval(() => {
      void scanPorts();
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [scanPorts]);

  // Auto-dismiss notification when FlashPanel is opened
  useEffect(() => {
    if (isFlashOpen && notification) {
      setDismissed(true);
    }
  }, [isFlashOpen, notification]);

  const handleConnect = () => {
    if (notification) {
      onDeviceConnected(notification);
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  const showNotification = notification && !dismissed && !isFlashOpen;
  const deviceName = notification?.board || notification?.product || notification?.manufacturer || 'USB Serial Device';

  return (
    <AnimatePresence>
      {showNotification && (
        <motion.div
          initial={{ y: 100, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 100, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[420px] max-w-[calc(100vw-32px)]"
        >
          <div className="bg-[#0d0d0d] border border-neutral-700/60 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden backdrop-blur-xl">
            {/* Top accent bar */}
            <div className="h-[3px] bg-gradient-to-r from-green-500 via-emerald-400 to-teal-500" />

            <div className="p-4">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/15 border border-green-500/20">
                    <Cpu size={20} className="text-green-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-white">{deviceName}</h4>
                      <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        Detected
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {notification?.port}
                      {notification?.chip ? ` · ${notification.chip}` : ''}
                      {notification?.defaultBaud ? ` · ${notification.defaultBaud} baud` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleDismiss}
                  className="rounded-lg p-1 text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Device details */}
              {(notification?.vid_pid || notification?.serial_number) && (
                <div className="mt-2.5 flex gap-3 text-[10px] font-mono text-neutral-500">
                  {notification?.vid_pid && <span>USB ID: {notification.vid_pid}</span>}
                  {notification?.serial_number && <span>S/N: {notification.serial_number}</span>}
                </div>
              )}

              {/* Action button */}
              <button
                onClick={handleConnect}
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
  );
}
