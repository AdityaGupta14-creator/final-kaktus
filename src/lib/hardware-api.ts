import { auth } from '@/lib/firebase';

const hardwareApiBase = (
  process.env.NEXT_PUBLIC_FLASH_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

type LoopbackRequestInit = RequestInit & { targetAddressSpace?: 'loopback' | 'local' };

export function hardwareApiUrl(path: string): string {
  return `${hardwareApiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function hardwareFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }

  const url = hardwareApiUrl(path);

  // Chrome 130+ W3C Local Network Access specification uses 'loopback' for 127.0.0.1
  try {
    const requestInit: LoopbackRequestInit = {
      cache: 'no-store',
      ...init,
      headers,
      targetAddressSpace: 'loopback',
    };
    return await fetch(url, requestInit);
  } catch (err: any) {
    const errText = String(err?.message || err || '').toLowerCase();
    // Fallback if browser does not support 'loopback' but accepts 'local'
    if (errText.includes('targetaddressspace') || errText.includes('invalid') || errText.includes('typeerror')) {
      try {
        const fallbackInit: LoopbackRequestInit = {
          cache: 'no-store',
          ...init,
          headers,
          targetAddressSpace: 'local',
        };
        return await fetch(url, fallbackInit);
      } catch {}
    }
    throw err;
  }
}

export async function hardwareResponseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: string; error?: string } | null;
  return body?.detail || body?.error || `Hardware service returned HTTP ${response.status}.`;
}

export type BridgeConnectionState =
  | 'checking'
  | 'connected'
  | 'not-running'
  | 'permission-required'
  | 'cors-rejected'
  | 'error';

export interface BridgeHealthCheckResult {
  state: BridgeConnectionState;
  ready: boolean;
  compilerReady: boolean;
  version?: string;
  service?: string;
  error?: string;
  detail?: string;
  statusCode?: number;
}

export function classifyHardwareError(error: unknown, status?: number): {
  state: BridgeConnectionState;
  message: string;
  permissionRequired: boolean;
} {
  if (status === 403) {
    return {
      state: 'cors-rejected',
      message: 'Access denied: The local hardware service rejected requests from this origin.',
      permissionRequired: false,
    };
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      state: 'error',
      message: 'Request cancelled.',
      permissionRequired: false,
    };
  }

  const errStr = String(error instanceof Error ? error.message : error || '').toLowerCase();

  // Explicit Chrome Local Network Access / loopback address space permission denial
  const isPermissionDenied =
    errStr.includes('permission was denied') ||
    errStr.includes('loopback address space') ||
    errStr.includes('local network') ||
    errStr.includes('notallowederror') ||
    errStr.includes('securityerror') ||
    errStr.includes('blocked_by_local_network_access_checks');

  if (isPermissionDenied) {
    return {
      state: 'permission-required',
      message: 'Browser local-network / loopback access was denied for this website.',
      permissionRequired: true,
    };
  }

  if (errStr.includes('http 403') || errStr.includes('forbidden')) {
    return {
      state: 'cors-rejected',
      message: 'Access denied: The local hardware service rejected requests from this origin.',
      permissionRequired: false,
    };
  }

  if (error instanceof TypeError || errStr.includes('failed to fetch') || errStr.includes('networkerror') || errStr.includes('econnrefused')) {
    const isBrowser = typeof window !== 'undefined';
    const isHttps = isBrowser && window.location.protocol === 'https:';
    if (isHttps) {
      return {
        state: 'permission-required',
        message: 'Browser local-network access may be blocked, or the local bridge is not running.',
        permissionRequired: true,
      };
    }
    return {
      state: 'not-running',
      message: 'The local hardware bridge is not running on http://127.0.0.1:8000.',
      permissionRequired: false,
    };
  }

  return {
    state: 'error',
    message: error instanceof Error ? error.message : 'The local USB service could not complete the request.',
    permissionRequired: false,
  };
}

export function describeHardwareConnectionError(error: unknown): string {
  const classified = classifyHardwareError(error);
  if (classified.state === 'permission-required') {
    return 'The local USB service is not reachable. Allow "Apps on device" / Local Network Access in your browser and ensure npm run hardware:bridge is running.';
  }
  if (classified.state === 'cors-rejected') {
    return 'The local USB service rejected this origin. Check KAKTUS_WEB_ORIGINS in .env.local.';
  }
  if (classified.state === 'not-running') {
    return 'The local USB bridge is not running. Start it with npm run hardware:bridge in the project folder.';
  }
  return classified.message;
}

/**
 * Checks the local bridge health with bounded retry and backoff strategy.
 * Prevents aggressive or infinite polling.
 */
export async function checkBridgeHealthWithRetry(options?: {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  signal?: AbortSignal;
}): Promise<BridgeHealthCheckResult> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 400;
  const backoffMultiplier = options?.backoffMultiplier ?? 1.8;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) {
      return {
        state: 'error',
        ready: false,
        compilerReady: false,
        error: 'Check cancelled.',
      };
    }

    options?.onAttempt?.(attempt, maxAttempts);

    try {
      // 1. Check bridge root endpoint
      const rootRes = await hardwareFetch('/', { signal: options?.signal });
      if (!rootRes.ok) {
        throw new Error(`Bridge returned HTTP ${rootRes.status}`);
      }
      const rootData = await rootRes.json().catch(() => ({})) as { flash_enabled?: boolean; service?: string; version?: string };
      if (rootData.flash_enabled !== true) {
        throw new Error('Endpoint on port 8000 is not a valid Kaktus hardware bridge.');
      }

      // 2. Check compiler / status endpoint
      let compilerReady = false;
      let statusError = '';
      try {
        const statusRes = await hardwareFetch('/flash/status', { signal: options?.signal });
        if (statusRes.ok) {
          const statusData = await statusRes.json().catch(() => ({})) as { ready?: boolean; error?: string; version?: string };
          compilerReady = statusData.ready === true;
          statusError = statusData.error || '';
        }
      } catch {
        // compiler check is secondary to bridge connectivity
      }

      return {
        state: 'connected',
        ready: true,
        compilerReady,
        service: rootData.service || 'kaktus-hardware-bridge',
        version: rootData.version || '1.0.0',
        error: statusError || undefined,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  const classified = classifyHardwareError(lastError);
  return {
    state: classified.state,
    ready: false,
    compilerReady: false,
    error: classified.message,
    detail: lastError instanceof Error ? lastError.message : undefined,
  };
}

/**
 * Checks the local terminal service health on port 3001.
 * Triggers browser Local Network Access prompt if not yet requested.
 */
export async function checkTerminalHealth(port = 3001, signal?: AbortSignal): Promise<{
  ok: boolean;
  state: 'connected' | 'not-running' | 'permission-required' | 'cors-rejected' | 'error';
  message?: string;
}> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
      method: 'GET',
      cache: 'no-store',
      signal,
      targetAddressSpace: 'loopback',
    } as any);

    if (res.ok) {
      return { ok: true, state: 'connected' };
    }
    if (res.status === 403) {
      return { ok: false, state: 'cors-rejected', message: 'Terminal service rejected connection from this origin.' };
    }
    return { ok: false, state: 'error', message: `Terminal health returned HTTP ${res.status}.` };
  } catch (err: any) {
    const classified = classifyHardwareError(err);
    const candidateState = classified.state;
    const finalState = (candidateState === 'not-running' || candidateState === 'permission-required' || candidateState === 'cors-rejected')
      ? candidateState
      : 'error';
    return {
      ok: false,
      state: finalState,
      message: classified.message,
    };
  }
}

