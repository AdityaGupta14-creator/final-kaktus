const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const { spawn } = require('child_process');

const DEFAULT_WEB_ORIGINS = new Set([
  'https://final-kaktus.vercel.app',
  'https://final-kaktus-hello-4da5.vercel.app',
  'https://final-kaktus-git-main-hello-4da5.vercel.app',
  'https://yc-drab.vercel.app',
]);

function isAllowedTerminalOrigin(origin) {
  if (!origin) return false;
  if (DEFAULT_WEB_ORIGINS.has(origin)) return true;
  const configuredOrigins = (process.env.KAKTUS_WEB_ORIGINS || process.env.KAKTUS_TERMINAL_ORIGINS || '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''));
  if (configuredOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const localHost = parsed.protocol === 'http:'
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1')
      && parsed.port === '3000';
    const trustedVercelPreview = parsed.protocol === 'https:'
      && /^final-kaktus(?:-[a-z0-9-]+)?\.vercel\.app$/.test(hostname);
    return localHost || trustedVercelPreview;
  } catch {
    return false;
  }
}

function startTerminalService({ port = 3001 } = {}) {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }, done) => {
      const allowed = isAllowedTerminalOrigin(origin);
      done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Kaktus IDE origin required.');
    },
  });
  let ownsListener = false;
  wss.on('listening', () => {
    ownsListener = true;
    console.log(`> Local terminal service ready on ws://127.0.0.1:${port}`);
  });
  wss.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.log(`> Local terminal service already running on 127.0.0.1:${port}`);
      return;
    }
    console.error(`> Local terminal service failed: ${error.message}`);
  });

  const sendTerminalMessage = (ws, message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  const runTerminalCommand = (ws, activeCommands, { id, command }) => {
    if (typeof id !== 'string' || !id || typeof command !== 'string' || !command.trim()) return;
    if (command.length > 8000) {
      sendTerminalMessage(ws, { type: 'exec-error', id, message: 'Command exceeds the 8,000-character limit.' });
      return;
    }
    if (activeCommands.size > 0) {
      sendTerminalMessage(ws, { type: 'exec-error', id, message: 'Another automated terminal command is still running.' });
      return;
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const args = os.platform() === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];
    let child;
    let timedOut = false;
    let finished = false;
    let outputBytes = 0;
    let outputTruncated = false;
    const outputLimitBytes = 128 * 1024;
    const finish = exitCode => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      activeCommands.delete(id);
      sendTerminalMessage(ws, { type: 'exec-complete', id, exitCode: timedOut ? 124 : (Number.isInteger(exitCode) ? exitCode : 1) });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!child || child.killed) return;
      if (os.platform() === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        child.kill('SIGTERM');
      }
    }, 120_000);
    timeout.unref?.();

    try {
      child = spawn(shell, args, {
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      activeCommands.set(id, child);

      const forwardOutput = chunk => {
        const data = chunk.toString();
        const remaining = Math.max(0, outputLimitBytes - outputBytes);
        const bounded = Buffer.from(data).subarray(0, remaining).toString();
        outputBytes += Buffer.byteLength(bounded);
        if (bounded) sendTerminalMessage(ws, { type: 'exec-output', id, data: bounded });
        if (!outputTruncated && Buffer.byteLength(data) > remaining) {
          outputTruncated = true;
          sendTerminalMessage(ws, { type: 'exec-output', id, data: '\n[Output truncated after 128 KB.]\n' });
        }
      };

      child.stdout.on('data', forwardOutput);
      child.stderr.on('data', forwardOutput);
      child.on('error', error => {
        sendTerminalMessage(ws, { type: 'exec-output', id, data: `${error.message}\n` });
        finish(1);
      });
      child.on('close', exitCode => finish(exitCode));
      child.stdin.end();
    } catch (error) {
      sendTerminalMessage(ws, { type: 'exec-error', id, message: error instanceof Error ? error.message : String(error) });
      finish(1);
    }
  };

  wss.on('connection', ws => {
    console.log('> Terminal WebSocket connected');
    const activeCommands = new Map();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    try {
      const terminalProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: process.cwd(),
        env: process.env,
      });

      terminalProcess.onData(data => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });
      terminalProcess.onExit(({ exitCode }) => {
        if (ws.readyState === ws.OPEN) ws.send(`\r\n[Terminal process exited with code ${exitCode}]\r\n`);
      });

      ws.on('message', message => {
        const data = message.toString();
        try {
          const payload = JSON.parse(data);
          if (payload?.type === 'exec') {
            runTerminalCommand(ws, activeCommands, payload);
            return;
          }
          if (payload?.type === 'resize' && Number.isFinite(payload.cols) && Number.isFinite(payload.rows)) {
            terminalProcess.resize(Math.max(2, Math.floor(payload.cols)), Math.max(1, Math.floor(payload.rows)));
            return;
          }
        } catch {
          // User input is plain terminal data, not a control message.
        }
        terminalProcess.write(data);
      });

      ws.on('close', () => {
        terminalProcess.kill();
        for (const child of activeCommands.values()) {
          if (child && !child.killed) child.kill();
        }
        activeCommands.clear();
      });
    } catch (error) {
      console.error('Failed to start local terminal shell:', error);
      sendTerminalMessage(ws, { type: 'terminal-error', message: 'Could not start a local shell. Check that PowerShell is installed.' });
    }
  });

  return {
    close() {
      if (!ownsListener) return;
      for (const client of wss.clients) client.close();
      wss.close();
    },
  };
}

module.exports = { startTerminalService };
