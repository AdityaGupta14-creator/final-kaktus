const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { startTerminalService } = require('./terminal-service');
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

  startTerminalService();

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
