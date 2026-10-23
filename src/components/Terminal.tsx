'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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

export const Terminal = forwardRef<TerminalRef, TerminalProps>(({ onStatusChange }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
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
  }));

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Cascadia Code, Consolas, "SFMono-Regular", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.32,
      scrollback: 5000,
      theme: {
        background: '#111214',
        foreground: '#d7dce2',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
        black: '#111214',
        brightBlack: '#727985',
        brightWhite: '#f0f4f8',
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
    if (!isLocalHost || window.location.protocol !== 'http:') {
      const reason = 'The local terminal is available when the app is opened at http://localhost:3000.';
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
    availabilityRef.current = 'available';
    const wsUrl = 'ws://127.0.0.1:3001';
    const failPendingCommands = (message: string) => {
      for (const pending of pendingCommandsRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.reject(new Error(message));
      }
      pendingCommandsRef.current.clear();
    };
    const connect = () => {
      if (disposed) return;
      statusCallbackRef.current?.(hasConnected ? 'disconnected' : 'connecting');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        hasConnected = true;
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
        statusCallbackRef.current?.('disconnected');
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (handleWindowResize) window.removeEventListener('resize', handleWindowResize);
        handleWindowResize = undefined;
        failPendingCommands('Terminal connection closed before the command completed. Reconnect and retry.');
        if (disposed) return;
        statusCallbackRef.current?.('disconnected');
        term.write('\r\n*** Terminal connection lost. Reconnecting... ***\r\n');
        reconnectTimer = window.setTimeout(connect, 1500);
      };
    };
    connect();

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else if (inputQueueLengthRef.current + data.length < 20_000) {
        inputQueueRef.current.push(data);
        inputQueueLengthRef.current += data.length;
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
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
      className="h-full w-full overflow-hidden bg-[#111214]"
      onClick={() => xtermRef.current?.focus()}
      title="Click to type in the terminal"
    >
      <div ref={terminalRef} className="h-full w-full px-3 py-2" />
    </div>
  );
});
Terminal.displayName = 'Terminal';
