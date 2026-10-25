const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { startTerminalService } = require('./terminal-service');

const backendDir = path.join(__dirname, 'backend');
const terminalService = startTerminalService();
let backend;
let stopping = false;

function stopServices() {
  if (stopping) return;
  stopping = true;
  if (backend && backend.exitCode === null) backend.kill();
  terminalService.close();
}

process.on('SIGINT', stopServices);
process.on('SIGTERM', stopServices);

const setup = spawnSync(process.execPath, [path.join(__dirname, 'hardware-setup.js')], {
  cwd: __dirname,
  stdio: 'inherit',
  windowsHide: true,
});
if (setup.error || setup.status !== 0) {
  if (setup.error) console.error(`Could not prepare the local USB bridge: ${setup.error.message}`);
  console.error('The local terminal remains available; USB flashing needs the Python bridge dependencies.');
  return;
}

if (!fs.existsSync(path.join(backendDir, 'main.py'))) {
  console.error('The local terminal is running; USB flashing is unavailable because backend/main.py is missing.');
  return;
}

const windowsPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
const unixPython = path.join(backendDir, 'venv', 'bin', 'python');
const python = (fs.existsSync(windowsPython) ? windowsPython : null)
  || (fs.existsSync(unixPython) ? unixPython : null)
  || (process.platform === 'win32' ? 'py' : 'python3');
const args = python === 'py'
  ? ['-3', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000']
  : ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'];
fetch('http://127.0.0.1:8000/')
  .then(async response => {
    const payload = response.ok ? await response.json().catch(() => ({})) : {};
    if (payload.flash_enabled === true) {
      console.log('The local USB bridge is already running at http://127.0.0.1:8000');
      return;
    }
    launchBridge();
  })
  .catch(launchBridge);

function launchBridge() {
  if (stopping || backend) return;
  backend = spawn(python, args, {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });

  backend.on('error', error => {
    console.error(`Could not start Python: ${error.message}`);
    console.error('Install local dependencies with: python -m pip install -r backend/requirements.txt');
  });
  backend.on('exit', code => {
    if (code !== null && code !== 0 && !stopping) {
      console.error(`The local USB bridge stopped with exit code ${code}. The terminal service remains available.`);
    }
  });
}
