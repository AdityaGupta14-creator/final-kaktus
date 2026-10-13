const hardwareApiBase = (
  process.env.NEXT_PUBLIC_FLASH_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

type LocalNetworkRequestInit = RequestInit & { targetAddressSpace: 'local' };

export function hardwareApiUrl(path: string): string {
  return `${hardwareApiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export function hardwareFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const requestInit: LocalNetworkRequestInit = {
    cache: 'no-store',
    ...init,
    targetAddressSpace: 'local',
  };

  return fetch(hardwareApiUrl(path), requestInit);
}

export async function hardwareResponseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { detail?: string; error?: string } | null;
  return body?.detail || body?.error || `Hardware service returned HTTP ${response.status}.`;
}

export function describeHardwareConnectionError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Request cancelled.';
  if (error instanceof TypeError) {
    return 'The local USB service is not reachable. Run the app on this computer and allow its local-network access in the browser.';
  }
  return error instanceof Error ? error.message : 'The local USB service could not complete the request.';
}
