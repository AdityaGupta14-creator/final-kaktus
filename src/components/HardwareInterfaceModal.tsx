'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Usb, Zap, Activity, Cable } from 'lucide-react';

interface HardwareInterfaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HardwareInterfaceModal({ isOpen, onClose }: HardwareInterfaceModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d10] p-6 md:p-8 text-white shadow-[0_20px_60px_rgba(0,0,0,0.9)]"
        >
          {/* Subtle Ambient Background Glows */}
          <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>

          {/* Header & Badge */}
          <div className="relative mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 shadow-[0_0_25px_rgba(59,130,246,0.25)]">
              <Usb className="h-7 w-7 text-blue-400" />
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-300 uppercase mb-3">
              <Usb size={12} />
              <span>Local USB bridge</span>
            </div>

            <h3 className="text-xl md:text-2xl font-bold tracking-tight text-white">
              Hardware Interface & Flashing
            </h3>
            <p className="mx-auto mt-2 max-w-md text-xs md:text-sm leading-relaxed text-zinc-400">
              Connect a supported board by USB. The local bridge detects its serial port and runs Arduino CLI to build, upload and monitor firmware.
            </p>
            <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-zinc-500">
              The local app starts its bridge automatically. The hosted site routes hardware work through the paired outbound bridge, so it does not need Chrome/Edge local-network permission. A local helper must be installed and running on the computer connected to the board.
            </p>
          </div>

          {/* Feature Highlights Preview */}
          <div className="relative space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
                <Cable size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">USB port detection</h4>
                <p className="text-[11px] text-zinc-400">Scans connected serial devices and displays the port, USB identifiers and serial number when the device provides one.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <Zap size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Build and upload</h4>
                <p className="text-[11px] text-zinc-400">Builds and uploads with Arduino CLI for Arduino AVR, ESP32, Raspberry Pi Pico RP2040 and STM32 Blue Pill with a UART bootloader.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-400">
                <Activity size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Serial monitor</h4>
                <p className="text-[11px] text-zinc-400">Reads live serial output and sends text commands using the baud rate configured in the sketch.</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-white cursor-pointer"
            >
              <span>Close</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
