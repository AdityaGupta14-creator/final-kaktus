const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

let terminalService;
try {
  const { startTerminalService } = require('./terminal-service');
  terminalService = startTerminalService();
} catch (err) {
  console.warn('[Terminal Service Note]', err.message);
}

const { startBridge } = require(path.join(__dirname, 'scripts', 'hardware-bridge-launcher.js'));

// Start bridge in interactive foreground mode (default for npm run hardware:bridge)
startBridge({ daemon: false, verbose: true }).then((result) => {
  if (result && result.alreadyRunning) {
    if (!terminalService) process.exit(0);
  } else if (!result || !result.ok) {
    process.exit(1);
  }
}).catch((err) => {
  console.error('[Hardware Bridge Fatal]', err);
  process.exit(1);
});

function stopServices() {
  if (terminalService) terminalService.close();
}

process.on('SIGINT', stopServices);
process.on('SIGTERM', stopServices);
