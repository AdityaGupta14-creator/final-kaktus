const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, 'backend');
const setup = spawnSync(process.execPath, [path.join(__dirname, 'hardware-setup.js')], {
  cwd: __dirname,
  stdio: 'inherit',
  windowsHide: true,
});
if (setup.error || setup.status !== 0) {
  if (setup.error) console.error(`Could not prepare the local USB bridge: ${setup.error.message}`);
  process.exit(setup.status || 1);
}
const windowsPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
const unixPython = path.join(backendDir, 'venv', 'bin', 'python');
const python = (fs.existsSync(windowsPython) ? windowsPython : null)
  || (fs.existsSync(unixPython) ? unixPython : null)
  || (process.platform === 'win32' ? 'py' : 'python3');
const args = python === 'py'
  ? ['-3', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000']
  : ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'];

if (!fs.existsSync(path.join(backendDir, 'main.py'))) {
  console.error('The local USB bridge source is missing: backend/main.py');
  process.exit(1);
}

fetch('http://127.0.0.1:8000/')
  .then(async (response) => {
    const payload = response.ok ? await response.json().catch(() => ({})) : {};
    if (payload.flash_enabled === true) {
      console.log('The local USB bridge is already running at http://127.0.0.1:8000');
      process.exit(0);
    }
    launchBridge();
  })
  .catch(launchBridge);

function launchBridge() {
  const bridge = spawn(python, args, {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });

  bridge.on('error', (error) => {
    console.error(`Could not start Python: ${error.message}`);
    console.error('Install local dependencies with: python -m pip install -r backend/requirements.txt');
    process.exitCode = 1;
  });
  bridge.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
  process.on('SIGINT', () => bridge.kill('SIGINT'));
  process.on('SIGTERM', () => bridge.kill('SIGTERM'));
}
