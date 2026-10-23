const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production' && !process.argv.includes('--production');
const app = next({ dev, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Start Next.js server on port 3000
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  
  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Next.js ready on http://localhost:3000');
  });

  // Keep shell access on loopback and accept connections only from the local IDE.
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 3001,
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }, done) => {
      try {
        const parsedOrigin = new URL(origin);
        const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        const allowed = parsedOrigin.protocol === 'http:'
          && localHosts.has(parsedOrigin.hostname.toLowerCase())
          && parsedOrigin.port === '3000';
        done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Local IDE origin required.');
      } catch {
        done(false, 403, 'Local IDE origin required.');
      }
    },
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
    const finish = (exitCode) => {
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

      const forwardOutput = (chunk) => {
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
      child.on('error', (error) => {
        sendTerminalMessage(ws, { type: 'exec-output', id, data: `${error.message}\n` });
        finish(1);
      });
      child.on('close', (exitCode) => finish(exitCode));
      child.stdin.end();
    } catch (error) {
      sendTerminalMessage(ws, { type: 'exec-error', id, message: error instanceof Error ? error.message : String(error) });
      finish(1);
    }
  };

  wss.on('connection', (ws) => {
    console.log('Terminal WebSocket connected on port 3001');
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

      terminalProcess.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });

      terminalProcess.onExit(({ exitCode }) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\n[Terminal process exited with code ${exitCode}]\r\n`);
        }
      });

      ws.on('message', (message) => {
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
    } catch (err) {
      console.error("Failed to spawn shell process:", err);
      ws.send(`\r\nError starting terminal: ${err.message}\r\n`);
    }
  });

  console.log('> Terminal WS ready on ws://127.0.0.1:3001');

  // The local bridge enumerates USB devices and invokes Arduino CLI. Bind it to
  // loopback only: a network-accessible unauthenticated flash service is unsafe.
  const backendDir = path.join(__dirname, 'backend');
  const venvPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
  const venvUnixPython = path.join(backendDir, 'venv', 'bin', 'python');
  const mainPy = path.join(backendDir, 'main.py');
  const fs = require('fs');

  const isBridgeReady = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/');
      const payload = response.ok ? await response.json().catch(() => ({})) : {};
      return payload.flash_enabled === true;
    } catch {
      return false;
    }
  };

  if (!fs.existsSync(mainPy)) {
    console.warn('> [Hardware] backend/main.py is missing; USB flashing is unavailable.');
  } else if (await isBridgeReady()) {
    console.log('> [Hardware] Local USB bridge already running on 127.0.0.1:8000');
  } else {
    const pythonCmd = (fs.existsSync(venvPython) ? venvPython : null)
      || (fs.existsSync(venvUnixPython) ? venvUnixPython : null)
      || (process.platform === 'win32' ? 'py' : 'python3');
    const pythonArgs = pythonCmd === 'py' ? ['-3', '-m', 'uvicorn'] : ['-m', 'uvicorn'];
    const backend = spawn(pythonCmd, [...pythonArgs, 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });

    backend.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`> [Hardware] ${msg}`);
    });
    backend.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`> [Hardware] ${msg}`);
    });
    backend.on('error', (err) => {
      console.warn(`> [Hardware] Could not start the local USB bridge: ${err.message}`);
      console.warn('> [Hardware] Install backend requirements, then run: npm run hardware:bridge');
    });
    backend.on('exit', (code) => {
      if (code !== null && code !== 0) console.warn(`> [Hardware] Bridge stopped with exit code ${code}.`);
      if (code === 1) console.warn('> [Hardware] Check backend/requirements.txt and the Python environment.');
    });

    const waitForReady = async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (backend.exitCode !== null) return false;
        if (await isBridgeReady()) return true;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return false;
    };

    waitForReady().then((ready) => {
      if (ready) console.log('> [Hardware] Local USB bridge ready on http://127.0.0.1:8000');
      else console.warn('> [Hardware] Bridge did not become ready. Run npm run hardware:bridge for diagnostics.');
    });

    process.on('exit', () => { try { backend.kill(); } catch {} });
    process.on('SIGINT', () => { try { backend.kill(); } catch {} process.exit(); });
    process.on('SIGTERM', () => { try { backend.kill(); } catch {} process.exit(); });
  }
});
