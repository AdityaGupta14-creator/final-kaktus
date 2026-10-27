#!/usr/bin/env node
'use strict';
/* eslint @typescript-eslint/no-require-imports: off */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(projectRoot, '.env.local') });

const VERSION = '1.0.0';
const LOCAL_API = 'http://127.0.0.1:8000';
const MAX_RESULT_BYTES = 1_000_000;
const ALLOWED_ROUTES = new Set([
  'GET /',
  'GET /flash/status',
  'GET /flash/boards',
  'GET /flash/upload/status',
  'POST /flash/compile',
  'POST /flash/upload',
  'POST /flash/install-core',
  'POST /flash/install-library',
  'POST /flash/serial-write',
]);

function readConfig() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const configPath = configIndex >= 0 ? args[configIndex + 1] : args.find((arg) => !arg.startsWith('-'));
  if (!configPath) throw new Error('Usage: node scripts/hardware-cloud-bridge.js --config <downloaded-config.json>');
  const absolutePath = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const api = new URL(config.apiBase);
  if (api.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(api.hostname)) {
    throw new Error('Bridge API must use HTTPS.');
  }
  if (!/^[a-f0-9]{24,48}$/.test(config.bridgeId || '') || typeof config.bridgeToken !== 'string' || config.bridgeToken.length < 40) {
    throw new Error('The bridge config is invalid. Pair this computer again from Kaktus.');
  }
  return { apiBase: api.origin, bridgeId: config.bridgeId, bridgeToken: config.bridgeToken };
}

async function relayRequest(config, payload) {
  const response = await fetch(`${config.apiBase}/api/hardware/relay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.bridgeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, bridgeId: config.bridgeId, agentVersion: VERSION }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Cloud relay returned HTTP ${response.status}.`);
  return result;
}

async function executeCommand(command) {
  if (!command || typeof command.path !== 'string' || typeof command.method !== 'string') {
    throw new Error('The relay sent a malformed hardware command.');
  }
  const method = command.method.toUpperCase();
  const target = new URL(command.path, LOCAL_API);
  if (target.origin !== LOCAL_API || target.hash || !ALLOWED_ROUTES.has(`${method} ${target.pathname}`)) {
    throw new Error('The relay command is outside the hardware operation allowlist.');
  }
  const headers = { Accept: 'application/json' };
  if (command.authToken) headers.Authorization = `Bearer ${command.authToken}`;
  const options = {
    method,
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(4 * 60_000),
  };
  if (method !== 'GET' && command.body !== null && command.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(command.body);
  }
  const response = await fetch(`${LOCAL_API}${target.pathname}${target.search}`, options);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('The local hardware service returned more than 1 MB.');
  }
  let responseBody = text;
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try { responseBody = JSON.parse(text); } catch {}
  }
  return { responseStatus: response.status, responseBody };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const config = readConfig();
  const { startBridge, startTerminalProcess, checkBridgeHealth, checkTerminalHealth } = require('./hardware-bridge-launcher');
  const terminal = startTerminalProcess({ daemon: true, verbose: true });
  if (!terminal?.ok) throw new Error(terminal?.error || 'Could not start the local hardware authorization service.');
  let terminalReady = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const health = await checkTerminalHealth(3001, 1000);
    if (health.ok) { terminalReady = true; break; }
    await sleep(350);
  }
  if (!terminalReady) throw new Error('The local hardware authorization service did not become ready. Check backend/bridge.log.');

  const localBridge = await startBridge({ daemon: true, verbose: true });
  if (!localBridge?.ok) throw new Error(localBridge?.error || 'Could not start the local USB hardware service.');
  let localReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const health = await checkBridgeHealth(8000, 1500);
    if (health.ok && health.isKaktus) { localReady = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!localReady) throw new Error('The local USB hardware service did not become ready. Check backend/bridge.log.');
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  console.log(`Kaktus Hardware Cloud Bridge ${VERSION}`);
  console.log('Waiting securely for this account’s hardware commands. Keep this window open.');
  while (!stopping) {
    try {
      const result = await relayRequest(config, { action: 'poll' });
      if (!result.command) {
        await sleep(3000);
        continue;
      }
      let output;
      const heartbeat = setInterval(() => {
        void relayRequest(config, { action: 'heartbeat' }).catch(() => {});
      }, 10_000);
      try {
        output = await executeCommand(result.command);
      } catch (error) {
        output = { responseStatus: 502, responseBody: { status: 'error', error: error instanceof Error ? error.message : 'Local hardware operation failed.' } };
      } finally {
        clearInterval(heartbeat);
      }
      await relayRequest(config, {
        action: 'result',
        commandId: result.command.id,
        responseStatus: output.responseStatus,
        responseBody: output.responseBody,
      });
      console.log(`Completed ${result.command.method} ${new URL(result.command.path, LOCAL_API).pathname} (${output.responseStatus}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection error';
      if (/revoked|invalid/i.test(message)) {
        console.error(`${message} Pair this computer again from Kaktus.`);
        process.exitCode = 1;
        break;
      }
      console.error(`Bridge connection issue: ${message}`);
      await sleep(3000);
    }
  }
  console.log('Kaktus Hardware Cloud Bridge stopped.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
