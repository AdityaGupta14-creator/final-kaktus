'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Usb, Cpu, Zap, Activity, Sparkles, Clock, Cable } from 'lucide-react';

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

            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold tracking-wider text-amber-300 uppercase mb-3">
              <Clock size={12} className="animate-spin text-amber-400" style={{ animationDuration: '6s' }} />
              <span>Feature In Development</span>
            </div>

            <h3 className="text-xl md:text-2xl font-bold tracking-tight text-white">
              Hardware Interface & Flashing
            </h3>
            <p className="mx-auto mt-2 max-w-md text-xs md:text-sm leading-relaxed text-zinc-400">
              Direct physical microcontroller connectivity, WebSerial communication, and 1-click in-browser firmware uploads are coming soon.
            </p>
          </div>

          {/* Feature Highlights Preview */}
          <div className="relative space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-400">
                <Cable size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Zero-Config USB & Serial Port Detection</h4>
                <p className="text-[11px] text-zinc-400">Automatic detection for Arduino Uno, Nano, Mega, and ESP32 with auto baud-rate sync.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <Zap size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">1-Click In-Browser Firmware Flashing</h4>
                <p className="text-[11px] text-zinc-400">Compile and flash generated code directly to your physical board without external software.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-400">
                <Activity size={14} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Real-time Telemetry & Serial Monitor</h4>
                <p className="text-[11px] text-zinc-400">Bi-directional serial console with live waveform graphing for sensor data and debug logs.</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:from-blue-500 hover:to-indigo-500 cursor-pointer"
            >
              <Sparkles size={14} />
              <span>Got it, keep me posted</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
