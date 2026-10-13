const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, 'backend');
const requirements = path.join(backendDir, 'requirements.txt');
const windowsPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
const unixPython = path.join(backendDir, 'venv', 'bin', 'python');
const venvPython = process.platform === 'win32' ? windowsPython : unixPython;
const configuredPython = process.env.KAKTUS_PYTHON;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: __dirname,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' exited with code ' + result.status);
}

try {
  if (!fs.existsSync(venvPython)) {
    const systemPython = configuredPython || (process.platform === 'win32' ? 'py' : 'python3');
    const createArgs = systemPython === 'py'
      ? ['-3', '-m', 'venv', path.join(backendDir, 'venv')]
      : ['-m', 'venv', path.join(backendDir, 'venv')];
    console.log('Creating an isolated Python environment for the USB bridge...');
    run(systemPython, createArgs);
  }

  const importCheck = spawnSync(venvPython, ['-c', 'import fastapi, serial, uvicorn'], {
    cwd: backendDir,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (importCheck.error) throw importCheck.error;
  if (importCheck.status !== 0) {
    console.log('Installing the USB bridge Python requirements...');
    run(venvPython, ['-m', 'pip', 'install', '-r', requirements]);
  }
  console.log('USB bridge dependencies are ready.');
} catch (error) {
  console.error('Could not prepare the local USB bridge:', error.message);
  console.error('Install Python 3, then run npm run hardware:setup again.');
  process.exit(1);
}
