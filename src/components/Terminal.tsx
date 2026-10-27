'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { auth } from '@/lib/firebase';
import { checkTerminalHealth } from '@/lib/hardware-api';
import '@xterm/xterm/css/xterm.css';

export type TerminalConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'unavailable';

export interface TerminalCommandResult {
  output: string;
  exitCode: number;
}

export interface TerminalRef {
  sendCommand: (cmd: string) => void;
  runCommand: (cmd: string) => Promise<TerminalCommandResult>;
  clear: () => void;
  focus: () => void;
  reconnect: () => void;
}

interface TerminalProps {
  onStatusChange?: (status: TerminalConnectionStatus) => void;
}

interface PendingCommand extends TerminalCommandResult {
  id: string;
  command: string;
  resolve: (result: TerminalCommandResult) => void;
  reject: (error: Error) => void;
  timeout: number;
  sent: boolean;
}

function connectToLoopbackTerminal(url: string, idToken: string, remoteSecurePage: boolean): WebSocket {
  const protocols = ['kaktus-terminal.v1', `kaktus-auth.${idToken}`];
  if (remoteSecurePage) {
    try {
      // Chromium Local Network Access: pass options object with targetAddressSpace
      return new (WebSocket as any)(url, {
        protocols,
        targetAddressSpace: 'loopback',
      });
    } catch {
      try {
        // Fallback for 3-argument signature if supported
        return new (WebSocket as any)(url, protocols, { targetAddressSpace: 'loopback' });
      } catch {
        // Standard fallback
      }
    }
  }
  return new WebSocket(url, protocols);
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(({ onStatusChange }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const reconnectRef = useRef<() => void>(() => undefined);
  const inputQueueRef = useRef<string[]>([]);
  const inputQueueLengthRef = useRef(0);
  const pendingCommandsRef = useRef(new Map<string, PendingCommand>());
  const availabilityRef = useRef<'unknown' | 'available' | 'unavailable'>('unknown');
  const statusCallbackRef = useRef(onStatusChange);
  statusCallbackRef.current = onStatusChange;

  useImperativeHandle(ref, () => ({
    sendCommand: (cmd: string) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        // Ensure command ends with a newline to execute it
        ws.send(cmd.endsWith('\r') ? cmd : cmd + '\r');
      } else {
        const queued = cmd.endsWith('\r') ? cmd : cmd + '\r';
        if (inputQueueLengthRef.current + queued.length < 20_000) {
          inputQueueRef.current.push(queued);
          inputQueueLengthRef.current += queued.length;
        }
      }
    },
    runCommand: (cmd: string) => new Promise<TerminalCommandResult>((resolve, reject) => {
      const ws = wsRef.current;
      if (availabilityRef.current === 'unavailable') {
        reject(new Error('The local terminal is disconnected. Reopen the terminal and try again.'));
        return;
      }

      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = window.setTimeout(() => {
        const pending = pendingCommandsRef.current.get(id);
        if (!pending) return;
        pendingCommandsRef.current.delete(id);
        pending.reject(new Error('Terminal command timed out after 2 minutes.'));
      }, 125_000);
      const pending: PendingCommand = { id, command: cmd, output: '', exitCode: 1, resolve, reject, timeout, sent: false };
      pendingCommandsRef.current.set(id, pending);

      if (ws?.readyState === WebSocket.OPEN) {
        xtermRef.current?.writeln(`\r\n> ${cmd}`);
        ws.send(JSON.stringify({ type: 'exec', id, command: cmd }));
        pending.sent = true;
      }
    }),
    clear: () => xtermRef.current?.clear(),
    focus: () => xtermRef.current?.focus(),
    reconnect: () => reconnectRef.current(),
  }));

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Cascadia Code, Consolas, "SFMono-Regular", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.38,
      scrollback: 5000,
      theme: {
        background: '#0b0e12',
        foreground: '#d7dee7',
        cursor: '#7ee787',
        cursorAccent: '#0b0e12',
        selectionBackground: '#264f78',
        black: '#0b0e12',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#e3b341',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#76e3ea',
        white: '#d7dee7',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#aff5b4',
        brightYellow: '#f2cc60',
        brightBlue: '#a5d6ff',
        brightMagenta: '#e2c5ff',
        brightCyan: '#b3f0ff',
        brightWhite: '#f0f6fc',
      }
    });
    xtermRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    term.write('Connecting to the local terminal service...\r\n');
    const sendResize = () => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows,
      }));
    };
    const fitTerminal = () => {
      try {
        fitAddon.fit();
        sendResize();
      } catch { /* The drawer can be mid-animation. */ }
    };
    const initialFit = window.setTimeout(() => {
      fitTerminal();
      term.focus();
    }, 40);
    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(terminalRef.current);
    let handleWindowResize: (() => void) | undefined;

    const hostname = window.location.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
    const isRemoteSecurePage = !isLocalHost && window.isSecureContext;
    if (!isLocalHost && !isRemoteSecurePage) {
      const reason = 'Open the secure Kaktus site or http://localhost:3000 to connect to this computer’s terminal.';
      availabilityRef.current = 'unavailable';
      statusCallbackRef.current?.('unavailable');
      term.write(`\r\n${reason}\r\n`);
      return () => {
        resizeObserver.disconnect();
        window.clearTimeout(initialFit);
        xtermRef.current = null;
        term.dispose();
      };
    }

    let disposed = false;
    let reconnectTimer: number | undefined;
    let hasConnected = false;
    let hasReportedUnavailable = false;
    let reconnectAttempts = 0;
    let connectAttempt = 0;
    availabilityRef.current = 'available';
    const wsUrl = 'ws://127.0.0.1:3001';
    const connectionHint = isLocalHost
      ? 'Restart the local app with npm run dev.'
      : 'Run npm run terminal:bridge in the project folder and allow the browser’s local-network prompt.';
    const failPendingCommands = (message: string) => {
      for (const pending of pendingCommandsRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error(message));
      }
      pendingCommandsRef.current.clear();
    };
    const connect = async () => {
      if (disposed) return;
      const attempt = ++connectAttempt;
      statusCallbackRef.current?.(hasConnected ? 'disconnected' : 'connecting');
      let ws: WebSocket;
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          availabilityRef.current = 'unavailable';
          statusCallbackRef.current?.('unavailable');
          if (!hasReportedUnavailable) {
            term.writeln('\r\nSign in to use the local terminal.');
            hasReportedUnavailable = true;
          }
          reconnectTimer = window.setTimeout(() => { void connect(); }, 5000);
          return;
        }

        // On remote HTTPS pages, probe HTTP health on 3001 first to trigger LNA prompt and check status
        if (isRemoteSecurePage && !hasConnected) {
          const probe = await checkTerminalHealth(3001);
          if (disposed || attempt !== connectAttempt) return;
          if (!probe.ok) {
            availabilityRef.current = 'unavailable';
            statusCallbackRef.current?.('unavailable');
            if (!hasReportedUnavailable) {
              hasReportedUnavailable = true;
              if (probe.state === 'permission-required') {
                term.writeln('\r\n[Local Network Access Required]');
                term.writeln('Chrome/Edge blocked access to the local terminal on 127.0.0.1:3001.');
                term.writeln('To grant permission:');
                term.writeln('  1. Click the tune/sliders icon next to the URL in the browser address bar.');
                term.writeln('  2. Open "Site settings", locate "Apps on device" (or "Local network access"), and set to "Allow".');
                term.writeln('  3. Run npm run terminal:bridge in your project folder, then press any key to retry.\r\n');
              } else if (probe.state === 'cors-rejected') {
                term.writeln('\r\n[Terminal Origin Rejected]');
                term.writeln('The local terminal service rejected connection from this website origin.');
                term.writeln('Add this origin to KAKTUS_WEB_ORIGINS in .env.local and restart the bridge.\r\n');
              } else {
                term.writeln('\r\nLocal terminal service is not running on 127.0.0.1:3001.');
                term.writeln('Run npm run terminal:bridge in the project folder to start it.');
                term.writeln('Press any key to retry connection.\r\n');
              }
            }
            return;
          }
        }

        const idToken = await currentUser.getIdToken();
        if (disposed || attempt !== connectAttempt) return;
        ws = connectToLoopbackTerminal(wsUrl, idToken, isRemoteSecurePage);
      } catch {
        if (disposed || attempt !== connectAttempt) return;
        availabilityRef.current = 'unavailable';
        statusCallbackRef.current?.(hasConnected ? 'disconnected' : 'unavailable');
        if (!hasConnected && !hasReportedUnavailable) {
          term.writeln(`\r\nLocal terminal service unavailable. ${connectionHint}`);
          hasReportedUnavailable = true;
        }
        reconnectTimer = window.setTimeout(() => { void connect(); }, 5000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        hasConnected = true;
        hasReportedUnavailable = false;
        reconnectAttempts = 0;
        availabilityRef.current = 'available';
        statusCallbackRef.current?.('connected');
        term.write('\r\n*** Connected to local terminal ***\r\n\r\n');
        sendResize();
        term.focus();
        handleWindowResize = fitTerminal;
        window.addEventListener('resize', handleWindowResize);
        const queuedInputs = inputQueueRef.current.splice(0);
        inputQueueLengthRef.current = 0;
        for (const queuedInput of queuedInputs) ws.send(queuedInput);
        for (const pending of pendingCommandsRef.current.values()) {
          if (pending.sent) continue;
          term.writeln(`\r\n> ${pending.command}`);
          ws.send(JSON.stringify({ type: 'exec', id: pending.id, command: pending.command }));
          pending.sent = true;
        }
      };

      ws.onmessage = (event) => {
        const handleMessage = (data: string) => {
          try {
            const payload = JSON.parse(data);
            if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
              const pending = typeof payload.id === 'string' ? pendingCommandsRef.current.get(payload.id) : undefined;
              if (payload.type === 'exec-output' && pending && typeof payload.data === 'string') {
                pending.output += payload.data;
                term.write(payload.data.replace(/\r?\n/g, '\r\n'));
                return;
              }
              if (payload.type === 'exec-complete' && pending) {
                window.clearTimeout(pending.timeout);
                pending.exitCode = Number.isInteger(payload.exitCode) ? payload.exitCode : 1;
                term.writeln(`\r\n[Process exited with code ${pending.exitCode}]`);
                pending.resolve({ output: pending.output, exitCode: pending.exitCode });
                pendingCommandsRef.current.delete(payload.id);
                return;
              }
              if (payload.type === 'exec-error' && pending) {
                pending.output += String(payload.message || 'Terminal command failed.');
                term.writeln(`\r\n${pending.output}`);
                window.clearTimeout(pending.timeout);
                pending.resolve({ output: pending.output, exitCode: 1 });
                pendingCommandsRef.current.delete(payload.id);
                return;
              }
              if (payload.type === 'terminal-error' && typeof payload.message === 'string') {
                term.writeln(`\r\n${payload.message}`);
                return;
              }
            }
          } catch {
            // PTY output is plain text; structured control messages are JSON.
          }
          term.write(data);
        };

        if (event.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => handleMessage(reader.result as string);
          reader.readAsText(event.data);
        } else {
          handleMessage(String(event.data));
        }
      };

      ws.onerror = () => {
        statusCallbackRef.current?.(hasConnected ? 'disconnected' : 'unavailable');
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (handleWindowResize) window.removeEventListener('resize', handleWindowResize);
        handleWindowResize = undefined;
        failPendingCommands('Terminal connection closed before the command completed. Reconnect and retry.');
        if (disposed) return;
        statusCallbackRef.current?.(hasConnected ? 'disconnected' : 'unavailable');
        if (hasConnected) {
          availabilityRef.current = 'available';
          term.write('\r\n*** Terminal connection lost. Reconnecting... ***\r\n');
        } else {
          reconnectAttempts += 1;
          if (reconnectAttempts >= 4) {
            availabilityRef.current = 'unavailable';
            statusCallbackRef.current?.('unavailable');
            term.writeln(`\r\nLocal terminal service unavailable. ${connectionHint}\r\nPress any key to retry connection.`);
            return;
          }
          if (!hasReportedUnavailable) {
            availabilityRef.current = 'unavailable';
            term.writeln(`\r\nLocal terminal service unavailable. ${connectionHint}`);
            hasReportedUnavailable = true;
          }
        }
        reconnectTimer = window.setTimeout(connect, Math.min(6000, 1500 * Math.pow(1.5, reconnectAttempts)));
      };
    };
    reconnectRef.current = () => {
      if (disposed) return;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      reconnectAttempts = 0;
      hasReportedUnavailable = false;
      connectAttempt += 1;
      const previousSocket = wsRef.current;
      wsRef.current = null;
      if (previousSocket) {
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.close();
      }
      term.writeln('\r\nRetrying local terminal connection…');
      void connect();
    };
    void connect();

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        if (availabilityRef.current === 'unavailable') {
          reconnectRef.current();
          return;
        }
        if (inputQueueLengthRef.current + data.length < 20_000) {
          inputQueueRef.current.push(data);
          inputQueueLengthRef.current += data.length;
        }
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectRef.current = () => undefined;
      failPendingCommands('Terminal was closed before the command completed.');
      resizeObserver.disconnect();
      window.clearTimeout(initialFit);
      if (handleWindowResize) window.removeEventListener('resize', handleWindowResize);
      const ws = wsRef.current;
      wsRef.current = null;
      xtermRef.current = null;
      term.dispose();
      ws?.close();
    };
  }, []);

  return (
    <div
      className="h-full w-full overflow-hidden bg-[#0b0e12]"
      onClick={() => xtermRef.current?.focus()}
      title="Click to type in the terminal"
    >
      <div ref={terminalRef} className="h-full w-full px-3 py-2" />
    </div>
  );
});
Terminal.displayName = 'Terminal';
