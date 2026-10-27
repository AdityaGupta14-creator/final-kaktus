const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const { spawn } = require('child_process');
const { createServer } = require('http');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

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
    return localHost;
  } catch {
    return false;
  }
}

function getFirebaseAuth() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Firebase project ID is not configured.');
  const app = getApps().find(existing => existing.name === '[DEFAULT]') || initializeApp({ projectId });
  return getAuth(app);
}

function startTerminalService({ port = 3001 } = {}) {
  const server = createServer((req, res) => {
    // Chrome Private Network Access (PNA) and CORS preflight handler
    if (req.method === 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin && isAllowedTerminalOrigin(origin)) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Sec-WebSocket-Protocol, Authorization, Content-Type, *',
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '600',
          'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
        });
        res.end();
        return;
      }
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin not allowed' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/verify-token'
      && req.headers.host === `127.0.0.1:${port}` && !req.headers.origin) {
      const authorization = String(req.headers.authorization || '');
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token || token.length > 4096) {
        res.writeHead(401, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      getFirebaseAuth().verifyIdToken(token)
        .then(() => {
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          res.end();
        })
        .catch(() => {
          res.writeHead(401, { 'Cache-Control': 'no-store' });
          res.end();
        });
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      const origin = req.headers.origin;
      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      };
      if (origin && isAllowedTerminalOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Private-Network'] = 'true';
        headers['Vary'] = 'Origin';
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, service: 'kaktus-terminal' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    handleProtocols: protocols => protocols.has('kaktus-terminal.v1') ? 'kaktus-terminal.v1' : false,
  });
  let ownsListener = false;
  server.on('listening', () => {
    ownsListener = true;
    console.log(`> Local terminal service ready on 127.0.0.1:${port}`);
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.log(`> Local terminal service already running on 127.0.0.1:${port}`);
      return;
    }
    console.error(`> Local terminal service failed: ${error.message}`);
  });

  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    const expectedHost = `127.0.0.1:${port}`;
    const offeredProtocols = String(request.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map(value => value.trim());
    const authProtocol = offeredProtocols.find(value => value.startsWith('kaktus-auth.'));
    const idToken = authProtocol?.slice('kaktus-auth.'.length);
    const reject = (status, message) => {
      if (!socket.destroyed) {
        socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      }
    };

    if (request.headers.host !== expectedHost || !isAllowedTerminalOrigin(origin)) {
      reject(403, 'Forbidden');
      return;
    }
    if (!offeredProtocols.includes('kaktus-terminal.v1') || !idToken || idToken.length > 4096) {
      reject(401, 'Unauthorized');
      return;
    }

    getFirebaseAuth().verifyIdToken(idToken)
      .then(decoded => {
        if (!decoded?.uid) throw new Error('Invalid Firebase identity.');
        wss.handleUpgrade(request, socket, head, ws => {
          ws.terminalUid = decoded.uid;
          wss.emit('connection', ws, request);
        });
      })
      .catch(() => reject(401, 'Unauthorized'));
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
    console.log('> Terminal WebSocket connected for an authenticated session');
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

  server.listen(port, '127.0.0.1');

  return {
    close() {
      if (!ownsListener) return;
      for (const client of wss.clients) client.close();
      wss.close();
      server.close();
    },
  };
}

module.exports = { startTerminalService };

if (require.main === module) {
  startTerminalService();
}
