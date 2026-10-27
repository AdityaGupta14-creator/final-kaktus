/**
 * Kaktus Hardware Bridge Launcher & Supervisor
 * 
 * Provides robust, Windows-friendly process management for the local USB hardware bridge:
 * - Singleton enforcement (prevents duplicate bridge instances)
 * - Safe port 8000 occupancy detection (identifies foreign processes and refuses to kill them)
 * - Reuse of existing running healthy bridge instances
 * - Foreground and background/daemon execution modes
 * - Graceful shutdown and PID file tracking
 * - Persistent logging to backend/bridge.log
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const pidFile = path.join(backendDir, '.bridge.pid');
const terminalPidFile = path.join(backendDir, '.terminal.pid');
const logFile = path.join(backendDir, 'bridge.log');
const terminalScript = path.join(rootDir, 'terminal-service.js');

/**
 * Checks if the Kaktus bridge is responding on the specified port.
 */
async function checkBridgeHealth(port = 8000, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!response.ok) return { ok: false, isKaktus: false, status: response.status };
    const payload = await response.json().catch(() => ({}));
    const isKaktus = payload.flash_enabled === true;
    return { ok: true, isKaktus, payload };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, isKaktus: false, error: err.message };
  }
}

/**
 * Checks if the local terminal service is responding on port 3001.
 */
async function checkTerminalHealth(port = 3001, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message };
  }
}

/**
 * Identifies any process occupying the given port on Windows/POSIX.
 * Returns { pid: number, name?: string, command?: string } or null if port is free.
 */
function getPortOccupant(port = 8000) {
  try {
    if (process.platform === 'win32') {
      const netstat = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
      if (netstat.stdout) {
        const lines = netstat.stdout.split('\n');
        for (const line of lines) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pidStr = parts[parts.length - 1];
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0) {
              let name = 'unknown';
              try {
                const task = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
                  encoding: 'utf8',
                  windowsHide: true,
                  timeout: 2000,
                });
                if (task.stdout && task.stdout.trim() && !task.stdout.includes('No tasks')) {
                  const firstCol = task.stdout.trim().split(',')[0].replace(/"/g, '');
                  if (firstCol) name = firstCol;
                }
              } catch {}
              return { pid, name };
            }
          }
        }
      }
      return null;
    } else {
      const res = spawnSync('lsof', ['-i', `:${port}`, '-t'], {
        encoding: 'utf8',
        timeout: 2000,
      });
      if (res.stdout && res.stdout.trim()) {
        const pid = parseInt(res.stdout.trim().split('\n')[0], 10);
        if (!isNaN(pid)) return { pid, name: 'unknown' };
      }
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Checks if a given PID is currently active.
 */
function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Reads stored PID from pidFile if valid and running.
 */
function getStoredPid() {
  try {
    if (fs.existsSync(pidFile)) {
      const raw = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(raw, 10);
      if (!isNaN(pid) && isPidAlive(pid)) {
        return pid;
      }
    }
  } catch {}
  return null;
}

/**
 * Resolves the appropriate Python executable for the bridge.
 */
function resolvePythonExecutable() {
  const windowsPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
  const unixPython = path.join(backendDir, 'venv', 'bin', 'python');
  if (fs.existsSync(windowsPython)) return windowsPython;
  if (fs.existsSync(unixPython)) return unixPython;
  return process.platform === 'win32' ? 'py' : 'python3';
}

/**
 * Ensures backend dependencies and venv are prepared.
 */
function ensureSetup() {
  const setupScript = path.join(rootDir, 'hardware-setup.js');
  if (!fs.existsSync(setupScript)) return;
  const res = spawnSync(process.execPath, [setupScript], {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error(`hardware-setup.js failed with code ${res.status}`);
  }
}

/**
 * Appends a timestamped log entry to bridge.log.
 */
function appendLog(message) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {}
}

/**
 * Starts the hardware bridge.
 * @param {Object} options
 * @param {boolean} options.daemon Run as detached background daemon
 * @param {boolean} options.verbose Print detailed status to stdout
 */
async function startBridge(options = {}) {
  const daemon = Boolean(options.daemon);
  const verbose = options.verbose !== false;

  if (verbose) console.log('Checking local hardware bridge status...');

  // 1. Is bridge already responding and healthy on 8000?
  const health = await checkBridgeHealth(8000, 2500);
  if (health.ok && health.isKaktus) {
    const occupant = getPortOccupant(8000);
    const pidMsg = occupant?.pid ? ` (PID: ${occupant.pid})` : '';
    const msg = `Kaktus hardware bridge is already running and healthy on http://127.0.0.1:8000${pidMsg}.`;
    if (verbose) console.log(`✓ ${msg}`);
    appendLog(msg);
    if (occupant?.pid) {
      fs.writeFileSync(pidFile, String(occupant.pid), 'utf8');
    }
    return { ok: true, alreadyRunning: true, pid: occupant?.pid };
  }

  // 2. Check if port 8000 is occupied by an unrelated foreign process
  const occupant = getPortOccupant(8000);
  if (occupant && occupant.pid) {
    // If occupied but didn't pass Kaktus health check, DO NOT kill it automatically!
    const errText = `Port 8000 is occupied by another process (PID: ${occupant.pid}, Name: ${occupant.name || 'unknown'}${occupant.path ? `, Path: ${occupant.path}` : ''}). Refusing to terminate foreign process automatically.`;
    console.error(`\n❌ [Hardware Bridge Conflict] ${errText}`);
    console.error('To resolve this, free port 8000 or terminate that process manually before starting the bridge.\n');
    appendLog(`ERROR: ${errText}`);
    return { ok: false, error: errText, conflictPid: occupant.pid };
  }

  // 3. Ensure Python environment
  try {
    ensureSetup();
  } catch (err) {
    const setupErr = `Failed to prepare Python environment: ${err.message}`;
    console.error(`❌ ${setupErr}`);
    appendLog(`ERROR: ${setupErr}`);
    return { ok: false, error: setupErr };
  }

  const pythonCmd = resolvePythonExecutable();
  const pythonArgs = pythonCmd === 'py'
    ? ['-3', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000']
    : ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'];

  if (verbose) console.log(`Starting hardware bridge using Python at: ${pythonCmd}...`);
  appendLog(`Launching bridge with ${pythonCmd} ${pythonArgs.join(' ')}`);

  if (daemon) {
    // Background daemon mode (for Windows login autostart or background launcher)
    if (process.platform === 'win32') {
      const escapedPython = pythonCmd.replace(/"/g, '""');
      const cmdStr = `start "KaktusHardwareBridge" /b "${escapedPython}" ${pythonArgs.join(' ')} >> "${logFile}" 2>&1`;
      spawnSync('cmd.exe', ['/c', cmdStr], {
        cwd: backendDir,
        windowsHide: true,
      });
    } else {
      const logFd = fs.openSync(logFile, 'a');
      const child = spawn(pythonCmd, pythonArgs, {
        cwd: backendDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      child.unref();
    }

    if (verbose) process.stdout.write('Waiting for bridge to become ready...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const poll = await checkBridgeHealth(8000, 1000);
      if (poll.ok && poll.isKaktus) {
        ready = true;
        break;
      }
      if (verbose) process.stdout.write('.');
    }
    if (verbose) console.log('');

    const occupantNow = getPortOccupant(8000);
    const resolvedPid = occupantNow?.pid;

    if (ready) {
      if (resolvedPid) {
        fs.writeFileSync(pidFile, String(resolvedPid), 'utf8');
      }
      const msg = `Hardware bridge successfully started in background${resolvedPid ? ` (PID: ${resolvedPid})` : ''} on http://127.0.0.1:8000`;
      if (verbose) console.log(`✓ ${msg}`);
      appendLog(msg);
      return { ok: true, started: true, pid: resolvedPid };
    } else {
      const failMsg = `Bridge was launched but did not become ready within 10 seconds. Check backend/bridge.log for details.`;
      console.error(`⚠️ ${failMsg}`);
      appendLog(`WARNING: ${failMsg}`);
      return { ok: false, error: failMsg };
    }
  } else {
    // Foreground interactive mode
    const child = spawn(pythonCmd, pythonArgs, {
      cwd: backendDir,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });

    if (child.pid) {
      fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    }

    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });

    const cleanShutdown = (signal) => {
      appendLog(`Bridge terminating on signal ${signal}`);
      try {
        if (child.pid && isPidAlive(child.pid)) {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
          } else {
            child.kill('SIGTERM');
          }
        }
      } catch {}
      try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch {}
      process.exit(0);
    };

    process.on('SIGINT', () => cleanShutdown('SIGINT'));
    process.on('SIGTERM', () => cleanShutdown('SIGTERM'));

    return new Promise((resolve) => {
      child.on('exit', (code) => {
        try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch {}
        appendLog(`Bridge exited with code ${code}`);
        resolve({ ok: code === 0, exitCode: code });
      });
    });
  }
}

/**
 * Ensures the terminal service on port 3001 is running.
 */
function startTerminalProcess(options = {}) {
  const { daemon = false, verbose = true } = options;
  const occupant = getPortOccupant(3001);
  if (occupant && occupant.pid) {
    if (verbose) console.log(`✓ Terminal service already running on 127.0.0.1:3001 (PID: ${occupant.pid}).`);
    return { ok: true, alreadyRunning: true, pid: occupant.pid };
  }

  if (fs.existsSync(terminalScript)) {
    if (daemon) {
      const outFd = fs.openSync(logFile, 'a');
      const errFd = fs.openSync(logFile, 'a');
      const child = spawn(process.execPath, [terminalScript], {
        cwd: rootDir,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        env: { ...process.env },
        windowsHide: true,
      });
      child.unref();
      if (child.pid) {
        fs.writeFileSync(terminalPidFile, String(child.pid), 'utf8');
      }
      if (verbose) console.log(`✓ Terminal service launched in background (PID: ${child.pid}) on 127.0.0.1:3001.`);
      return { ok: true, started: true, pid: child.pid };
    } else {
      try {
        const { startTerminalService } = require(terminalScript);
        const svc = startTerminalService({ port: 3001 });
        if (verbose) console.log(`✓ Terminal service ready on 127.0.0.1:3001.`);
        return { ok: true, instance: svc };
      } catch (err) {
        if (verbose) console.warn(`> [Terminal Note] Could not start in-process terminal service: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }
  }
  return { ok: false, error: 'terminal-service.js not found' };
}

/**
 * Stops any running Kaktus bridge and terminal service. Refuses to stop foreign processes.
 */
async function stopBridge() {
  const occupant = getPortOccupant(8000);
  const storedPid = getStoredPid();
  const pidToStop = occupant?.pid || storedPid;

  if (!pidToStop) {
    console.log('No bridge process found listening on port 8000.');
    try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch {}
  } else {
    // Verify it is Kaktus bridge before killing!
    const health = await checkBridgeHealth(8000, 2000);
    if (!health.ok && occupant && occupant.pid) {
      // If not healthy and port is occupied, double check if it's our stored PID
      if (storedPid !== occupant.pid) {
        console.error(`Refusing to stop process PID ${occupant.pid}: It does not respond as a Kaktus bridge and does not match stored PID.`);
        return { ok: false, error: 'Foreign process detected on port 8000.' };
      }
    }

    console.log(`Stopping Kaktus hardware bridge (PID: ${pidToStop})...`);
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pidToStop), '/T', '/F'], { windowsHide: true });
      } else {
        process.kill(pidToStop, 'SIGTERM');
      }
      try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch {}
      console.log('✓ Bridge stopped successfully.');
      appendLog(`Bridge PID ${pidToStop} stopped manually.`);
    } catch (err) {
      console.error(`Failed to stop bridge PID ${pidToStop}: ${err.message}`);
    }
  }

  // Also cleanly stop terminal service if running
  const termOccupant = getPortOccupant(3001);
  const storedTermPid = fs.existsSync(terminalPidFile) ? parseInt(fs.readFileSync(terminalPidFile, 'utf8').trim(), 10) : null;
  const termPid = termOccupant?.pid || storedTermPid;
  if (termPid && isPidAlive(termPid)) {
    console.log(`Stopping Kaktus terminal service (PID: ${termPid})...`);
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(termPid), '/T', '/F'], { windowsHide: true });
      } else {
        process.kill(termPid, 'SIGTERM');
      }
    } catch {}
    try { if (fs.existsSync(terminalPidFile)) fs.unlinkSync(terminalPidFile); } catch {}
    console.log('✓ Terminal service stopped.');
  }

  return { ok: true, stopped: true };
}

/**
 * Prints diagnostic status of the bridge and terminal service.
 */
async function statusBridge() {
  const health = await checkBridgeHealth(8000, 2500);
  const occupant = getPortOccupant(8000);
  const storedPid = getStoredPid();

  const termHealth = await checkTerminalHealth(3001, 1500);
  const termOccupant = getPortOccupant(3001);

  console.log('=== Kaktus Local Services Status ===');
  console.log(`[Bridge :8000] Responding:   ${health.ok ? 'Yes (HTTP 200)' : 'No'}`);
  console.log(`[Bridge :8000] Is Kaktus:     ${health.isKaktus ? 'Yes' : 'No'}`);
  console.log(`[Bridge :8000] Occupying PID: ${occupant?.pid || 'None'}${occupant?.name ? ` (${occupant.name})` : ''}`);
  console.log(`[Bridge :8000] Lockfile PID:  ${storedPid || 'None'}`);

  if (health.ok && health.isKaktus) {
    console.log(`[Bridge :8000] Service:       ${health.payload.service || 'Gatekeeper API'}`);
    console.log(`[Bridge :8000] Status:        HEALTHY`);
  } else if (occupant?.pid) {
    console.log(`[Bridge :8000] Status:        CONFLICT (Port occupied by another process)`);
  } else {
    console.log(`[Bridge :8000] Status:        STOPPED / OFFLINE`);
  }

  console.log('------------------------------------');
  console.log(`[Terminal :3001] Responding:  ${termHealth.ok ? 'Yes (HTTP 200)' : 'No'}`);
  console.log(`[Terminal :3001] PID:         ${termOccupant?.pid || 'None'}${termOccupant?.name ? ` (${termOccupant.name})` : ''}`);
  console.log(`[Terminal :3001] Status:      ${termHealth.ok ? 'HEALTHY' : termOccupant?.pid ? 'OCCUPIED' : 'OFFLINE'}`);
  console.log('====================================');

  return { health, occupant, storedPid, termHealth, termOccupant };
}

// CLI Execution entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--stop')) {
    stopBridge().then((res) => process.exit(res.ok ? 0 : 1));
  } else if (args.includes('--status')) {
    statusBridge().then(() => process.exit(0));
  } else {
    const isDaemon = args.includes('--daemon') || args.includes('-d');
    startBridge({ daemon: isDaemon }).then((res) => {
      startTerminalProcess({ daemon: isDaemon });
      if (isDaemon) process.exit(res.ok ? 0 : 1);
    });
  }
}

module.exports = {
  checkBridgeHealth,
  checkTerminalHealth,
  startTerminalProcess,
  getPortOccupant,
  isPidAlive,
  getStoredPid,
  startBridge,
  stopBridge,
  statusBridge,
  backendDir,
  pidFile,
  terminalPidFile,
  logFile,
};
