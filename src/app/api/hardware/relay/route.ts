export const runtime = 'nodejs';
export const maxDuration = 30;

import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@/lib/server/firebase-admin';
import { extractBearerToken, requireAuthenticatedUser } from '@/lib/server/auth';
import { checkSharedRateLimit, rateLimitExceededResponse } from '@/lib/server/rate-limiter';

const devices = db.collection('hardware_bridge_devices');
const MAX_COMMAND_BYTES = 1_000_000;
const MAX_RESULT_BYTES = 1_000_000;
const COMMAND_TTL_MS = 6 * 60 * 1000;
const ALLOWED_ROUTES = new Map<string, string>([
  ['GET /', 'health'],
  ['GET /flash/status', 'status'],
  ['GET /flash/boards', 'boards'],
  ['POST /flash/compile', 'compile'],
  ['POST /flash/upload', 'upload'],
  ['POST /flash/install-core', 'install-core'],
  ['POST /flash/install-library', 'install-library'],
  ['POST /flash/serial-write', 'serial-write'],
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24,48}$/.test(value);
}

function bearer(request: Request): string {
  return extractBearerToken(request) || '';
}

async function bridgeDocument(bridgeId: unknown, token: string) {
  if (!validId(bridgeId) || !token || token.length > 128) return null;
  const ref = devices.doc(bridgeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  const actual = Buffer.from(String(data.secretHash || ''), 'hex');
  const supplied = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'), 'hex');
  if (!data.active || actual.length !== supplied.length || !crypto.timingSafeEqual(actual, supplied)) return null;
  return { ref, data };
}

function allowedCommand(methodValue: unknown, pathValue: unknown): { method: string; path: string; kind: string } | null {
  if (typeof methodValue !== 'string' || typeof pathValue !== 'string' || pathValue.length > 800) return null;
  let parsed: URL;
  try { parsed = new URL(pathValue, 'http://127.0.0.1:8000'); } catch { return null; }
  if (parsed.origin !== 'http://127.0.0.1:8000' || parsed.hash) return null;
  const method = methodValue.toUpperCase();
  const kind = ALLOWED_ROUTES.get(`${method} ${parsed.pathname}`);
  if (!kind) return null;
  if (parsed.pathname === '/flash/serial-monitor') return null;
  return { method, path: `${parsed.pathname}${parsed.search}`, kind };
}

async function readJson(request: Request): Promise<JsonObject | null> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_COMMAND_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return object(parsed) ? parsed : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    const user = await requireAuthenticatedUser(request);
    if (action === 'devices') {
      const snapshot = await devices.where('ownerUid', '==', user.uid).get();
      const list = snapshot.docs.map((doc) => {
        const data = doc.data();
        return { id: doc.id, active: data.active === true, createdAt: data.createdAt || null, lastSeenAt: data.lastSeenAt || null, label: data.label || 'This computer' };
      }).filter((device) => device.active);
      list.sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0));
      return Response.json({ devices: list }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'command') {
      const commandId = url.searchParams.get('commandId') || '';
      const bridgeId = url.searchParams.get('bridgeId') || '';
      if (!validId(commandId) || !validId(bridgeId)) return Response.json({ error: 'Invalid relay command.' }, { status: 400 });
      const snapshot = await devices.doc(bridgeId).collection('commands').doc(commandId).get();
      if (!snapshot.exists || snapshot.get('ownerUid') !== user.uid) return Response.json({ error: 'Relay command not found.' }, { status: 404 });
      const data = snapshot.data()!;
      if (data.expiresAt < Date.now() && data.status !== 'complete') {
        await snapshot.ref.update({ status: 'expired', updatedAt: Date.now() });
        return Response.json({ status: 'expired' }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return Response.json({ status: data.status, responseStatus: data.responseStatus || null, responseBody: data.responseBody ?? null, error: data.error || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ error: 'Unknown relay action.' }, { status: 400 });
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    return Response.json({ error: status === 500 ? 'Hardware relay request failed.' : (error as Error).message }, { status });
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_COMMAND_BYTES + 4096) return Response.json({ error: 'Relay payload is too large.' }, { status: 413 });
  const body = await readJson(request);
  if (!body) return Response.json({ error: 'Relay request must be valid JSON under 1 MB.' }, { status: 400 });
  const action = body.action;

  if (action === 'poll' || action === 'result' || action === 'heartbeat') {
    const bridge = await bridgeDocument(body.bridgeId, bearer(request));
    if (!bridge) return Response.json({ error: 'Bridge credentials are invalid or revoked.' }, { status: 401 });
    const agentLimit = await checkSharedRateLimit(bridge.ref.id, 'hardware_bridge_agent', 90, 60);
    if (!agentLimit.allowed) return rateLimitExceededResponse(agentLimit);
    const now = Date.now();
    if (action === 'heartbeat') {
      await bridge.ref.update({ lastSeenAt: now, agentVersion: typeof body.agentVersion === 'string' ? body.agentVersion.slice(0, 40) : 'unknown' });
      return Response.json({ ok: true });
    }
    if (action === 'poll') {
      await bridge.ref.update({ lastSeenAt: now });
      const queued = await bridge.ref.collection('commands').where('status', '==', 'queued').limit(20).get();
      const pending = queued.docs.filter((doc) => doc.get('expiresAt') > now);
      await Promise.all(queued.docs.filter((doc) => doc.get('expiresAt') <= now)
        .map((doc) => doc.ref.update({ status: 'expired', updatedAt: now })));
      const candidate = pending
        .sort((a, b) => Number(a.get('createdAt')) - Number(b.get('createdAt')))[0];
      if (!candidate) return Response.json({ command: null });
      const claim = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(candidate.ref);
        if (!current.exists || current.get('status') !== 'queued' || current.get('bridgeId') !== bridge.ref.id || current.get('expiresAt') <= Date.now()) return null;
        transaction.update(candidate.ref, { status: 'running', startedAt: now, updatedAt: now, authToken: FieldValue.delete() });
        const data = current.data()!;
        return { id: candidate.id, method: data.method, path: data.path, body: data.body ?? null, authToken: data.authToken || '' };
      });
      return Response.json({ command: claim });
    }
    const commandId = body.commandId;
    if (!validId(commandId) || !Number.isInteger(body.responseStatus) || Number(body.responseStatus) < 100 || Number(body.responseStatus) > 599) {
      return Response.json({ error: 'Invalid bridge result.' }, { status: 400 });
    }
    const responseBody = body.responseBody;
    const serialized = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody ?? null);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) return Response.json({ error: 'Bridge result is too large.' }, { status: 413 });
    const commandRef = bridge.ref.collection('commands').doc(commandId);
    const command = await commandRef.get();
    if (!command.exists || command.get('bridgeId') !== bridge.ref.id || command.get('status') !== 'running') {
      return Response.json({ error: 'Command is no longer active.' }, { status: 409 });
    }
    await commandRef.update({ status: 'complete', responseStatus: Number(body.responseStatus), responseBody: responseBody ?? null, updatedAt: now });
    return Response.json({ ok: true });
  }

  let user;
  try { user = await requireAuthenticatedUser(request); }
  catch (error) {
    const status = (error as { status?: number })?.status || 500;
    return Response.json({ error: (error as Error).message }, { status });
  }

  if (action === 'register') {
    const rate = await checkSharedRateLimit(user.uid, 'hardware_bridge_register', 5, 3600);
    if (!rate.allowed) return rateLimitExceededResponse(rate);
    const existing = await devices.where('ownerUid', '==', user.uid).get();
    if (existing.docs.filter((doc) => doc.get('active') === true).length >= 3) {
      return Response.json({ error: 'You can pair up to three computers. Revoke an old bridge first.' }, { status: 409 });
    }
    const bridgeId = crypto.randomBytes(16).toString('hex');
    const bridgeToken = crypto.randomBytes(32).toString('base64url');
    await devices.doc(bridgeId).create({
      ownerUid: user.uid,
      secretHash: crypto.createHash('sha256').update(bridgeToken).digest('hex'),
      active: true,
      label: typeof body.label === 'string' ? body.label.slice(0, 80) : 'This computer',
      createdAt: Date.now(),
      lastSeenAt: null,
      agentVersion: null,
    });
    return Response.json({ bridgeId, bridgeToken, apiBase: new URL(request.url).origin }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (action === 'revoke') {
    if (!validId(body.bridgeId)) return Response.json({ error: 'Invalid bridge id.' }, { status: 400 });
    const ref = devices.doc(body.bridgeId);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get('ownerUid') !== user.uid) return Response.json({ error: 'Bridge not found.' }, { status: 404 });
    await ref.update({ active: false, revokedAt: Date.now(), secretHash: crypto.randomBytes(32).toString('hex') });
    return Response.json({ ok: true });
  }

  if (action === 'enqueue') {
    const rate = await checkSharedRateLimit(user.uid, 'hardware_bridge_command', 120, 60);
    if (!rate.allowed) return rateLimitExceededResponse(rate);
    const bridgeId = body.bridgeId;
    const target = allowedCommand(body.method, body.path);
    if (!validId(bridgeId) || !target) return Response.json({ error: 'This hardware operation is not supported by the cloud bridge.' }, { status: 400 });
    const bridgeRef = devices.doc(bridgeId);
    const bridgeSnapshot = await bridgeRef.get();
    if (!bridgeSnapshot.exists || bridgeSnapshot.get('ownerUid') !== user.uid || bridgeSnapshot.get('active') !== true) {
      return Response.json({ error: 'Pair a computer with the Kaktus Hardware Bridge first.' }, { status: 409 });
    }
    const originalToken = bearer(request);
    const commandId = crypto.randomBytes(16).toString('hex');
    await bridgeRef.collection('commands').doc(commandId).create({
      ownerUid: user.uid,
      bridgeId,
      method: target.method,
      path: target.path,
      kind: target.kind,
      body: body.body ?? null,
      authToken: originalToken,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + COMMAND_TTL_MS,
    });
    return Response.json({ commandId, bridgeId, status: 'queued' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json({ error: 'Unknown relay action.' }, { status: 400 });
}
