import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import {
  checkBridgeHealth,
  getPortOccupant,
  startBridge,
} from '../scripts/hardware-bridge-launcher.js';
import {
  getAutostartConfig,
  enableAutostart,
  disableAutostart,
  checkStatus,
} from '../scripts/manage-bridge-autostart.js';
import {
  classifyHardwareError,
  checkBridgeHealthWithRetry,
} from '../src/lib/hardware-api';

describe('Kaktus Hardware Bridge & Autostart Suite', () => {
  describe('1. Health Check & Already Running Detection', () => {
    it('detects the running Kaktus hardware bridge on port 8000', async () => {
      const health = await checkBridgeHealth(8000, 2000);
      expect(health.ok).toBe(true);
      expect(health.isKaktus).toBe(true);
      expect(health.payload).toBeDefined();
      expect(health.payload.flash_enabled).toBe(true);
      expect(health.payload.service).toBe('kaktus-hardware-bridge');
    });

    it('reports not running when port is closed', async () => {
      const unusedPort = 59123;
      const health = await checkBridgeHealth(unusedPort, 500);
      expect(health.ok).toBe(false);
      expect(health.isKaktus).toBe(false);
    });
  });

  describe('2. Duplicate Start Prevention & Singleton Enforcement', () => {
    it('detects already running bridge and reuses it without spawning duplicate', async () => {
      const result = await startBridge({ daemon: false, verbose: false });
      expect(result.ok).toBe(true);
      expect(result.alreadyRunning).toBe(true);
      expect(result.pid).toBeDefined();
    });
  });

  describe('3. Foreign Process Port Occupancy & Conflict Safety', () => {
    let foreignServer: http.Server;
    const foreignPort = 8124;

    beforeAll(async () => {
      await new Promise<void>((resolve) => {
        foreignServer = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ foreign_app: 'unrelated_service' }));
        });
        foreignServer.listen(foreignPort, '127.0.0.1', () => resolve());
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        foreignServer.close(() => resolve());
      });
    });

    it('identifies foreign process and distinguishes it from Kaktus bridge', async () => {
      const health = await checkBridgeHealth(foreignPort, 1000);
      expect(health.ok).toBe(true);
      expect(health.isKaktus).toBe(false); // Does not contain flash_enabled: true
    });

    it('detects port occupant PID on the foreign port', () => {
      const occupant = getPortOccupant(foreignPort);
      expect(occupant).toBeDefined();
      expect(occupant?.pid).toBe(process.pid);
    });
  });

  describe('4. Invalid Bridge Health Responses', () => {
    let faultyServer: http.Server;
    const faultyPort = 8125;

    beforeAll(async () => {
      await new Promise<void>((resolve) => {
        faultyServer = http.createServer((_req, res) => {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Crash');
        });
        faultyServer.listen(faultyPort, '127.0.0.1', () => resolve());
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        faultyServer.close(() => resolve());
      });
    });

    it('handles HTTP error responses safely', async () => {
      const health = await checkBridgeHealth(faultyPort, 1000);
      expect(health.ok).toBe(false);
      expect(health.isKaktus).toBe(false);
    });
  });

  describe('5. Error Classification & Browser Permissions', () => {
    it('classifies TypeError as permission-required when on HTTPS origin', () => {
      // Mock window.location for browser simulation
      vi.stubGlobal('window', { location: { protocol: 'https:' } });
      const err = new TypeError('Failed to fetch');
      const classified = classifyHardwareError(err);
      expect(classified.state).toBe('permission-required');
      expect(classified.permissionRequired).toBe(true);
      expect(classified.message).toMatch(/Browser local-network access may be blocked/);
      vi.unstubAllGlobals();
    });

    it('classifies TypeError as not-running when on HTTP origin', () => {
      vi.stubGlobal('window', { location: { protocol: 'http:' } });
      const err = new TypeError('Failed to fetch');
      const classified = classifyHardwareError(err);
      expect(classified.state).toBe('not-running');
      expect(classified.permissionRequired).toBe(false);
      expect(classified.message).toMatch(/not running on http:\/\/127\.0\.0\.1:8000/);
      vi.unstubAllGlobals();
    });

    it('classifies AbortError properly', () => {
      const abortErr = new DOMException('The user aborted a request.', 'AbortError');
      const classified = classifyHardwareError(abortErr);
      expect(classified.state).toBe('error');
      expect(classified.message).toBe('Request cancelled.');
    });
  });

  describe('6. Bounded Retry Strategy & Delayed Recovery', () => {
    it('recovers gracefully when bridge becomes ready after initial failures', async () => {
      let attempts = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: true,
          json: async () => ({
            flash_enabled: true,
            service: 'kaktus-hardware-bridge',
            version: '1.0.0',
            ready: true,
          }),
        };
      });

      vi.stubGlobal('fetch', mockFetch);

      const result = await checkBridgeHealthWithRetry({
        maxAttempts: 3,
        initialDelayMs: 20,
        backoffMultiplier: 1.5,
      });

      expect(result.ready).toBe(true);
      expect(result.state).toBe('connected');
      expect(attempts).toBe(3); // 1st try failed, 2nd try succeeded root (and checked /flash/status)
      vi.unstubAllGlobals();
    });

    it('stops after maxAttempts without infinite polling when bridge remains stopped', async () => {
      let attempts = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts += 1;
        throw new TypeError('Failed to fetch');
      });

      vi.stubGlobal('fetch', mockFetch);
      vi.stubGlobal('window', { location: { protocol: 'http:' } });

      const result = await checkBridgeHealthWithRetry({
        maxAttempts: 3,
        initialDelayMs: 20,
        backoffMultiplier: 1.2,
      });

      expect(result.ready).toBe(false);
      expect(result.state).toBe('not-running');
      expect(attempts).toBe(3); // Strictly bounded, no repeated aggressive loop
      vi.unstubAllGlobals();
    });
  });

  describe('7. Windows Login Autostart Lifecycle', () => {
    it('manages user-level startup entry: enable, verify, status, disable', async () => {
      const config = getAutostartConfig();
      expect(config.targetFile).toBeDefined();

      // Enable autostart
      const enableResult = enableAutostart();
      expect(enableResult.ok).toBe(true);
      expect(fs.existsSync(config.targetFile)).toBe(true);

      // Verify file contents
      const content = fs.readFileSync(config.targetFile, 'utf8');
      if (config.platform === 'windows') {
        expect(content).toContain('WScript.Shell');
        expect(content).toContain('hardware-bridge-launcher.js');
        expect(content).toContain('--daemon');
      }

      // Check status reports enabled
      const statusEnabled = await checkStatus();
      expect(statusEnabled.isEnabled).toBe(true);

      // Disable autostart
      const disableResult = disableAutostart();
      expect(disableResult.ok).toBe(true);
      expect(disableResult.removed).toBe(true);
      expect(fs.existsSync(config.targetFile)).toBe(false);

      // Check status reports disabled
      const statusDisabled = await checkStatus();
      expect(statusDisabled.isEnabled).toBe(false);

      // Re-enable so it remains active for user
      enableAutostart();
      expect(fs.existsSync(config.targetFile)).toBe(true);
    });
  });
});
