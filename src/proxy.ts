import { NextRequest, NextResponse } from 'next/server';

// Log warning at startup if auth is disabled
const STYRMAN_API_TOKEN = process.env.STYRMAN_API_TOKEN?.trim() || '';
if (!STYRMAN_API_TOKEN) {
  console.warn('[SECURITY WARNING] STYRMAN_API_TOKEN not set - API authentication is DISABLED (local dev mode)');
}

/**
 * Check if a request originates from the same host (browser UI).
 * Same-origin browser requests include a Referer or Origin header
 * pointing to the MC server itself. Server-side render fetches
 * (Next.js RSC) come from the same process and have no Origin.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const host = request.headers.get('host');
  if (!host) return false;

  // Server-side fetches from Next.js (no origin/referer) — same process
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const fetchSite = request.headers.get('sec-fetch-site');

  // If neither origin nor referer is set, this is likely a server-side
  // fetch or a direct curl. Require auth for these (external API calls).
  if (!origin && !referer) {
    return fetchSite === 'same-origin' || fetchSite === 'same-site';
  }

  // Check if Origin matches the host
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {
      // Invalid origin header
    }
  }

  // Check if Referer matches the host
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return true;
    } catch {
      // Invalid referer header
    }
  }

  return false;
}

function hasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope) || scopes.includes('*');
}

type ScopedPayload = {
  v: 1 | 2;
  exp: number;
  task_id?: string;
  workspace_id?: string;
  session_id?: string;
  scopes: string[];
};

function getScopedSigningSecrets(): string[] {
  const token = (process.env.STYRMAN_API_TOKEN || '').trim();
  return token.length > 0 ? [token] : [];
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const normalized = authHeader.trim().replace(/^Bearer\s+Bearer\s+/i, 'Bearer ');
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim().replace(/^['"`]+|['"`]+$/g, '');
  return token.length > 0 ? token : null;
}

function toBase64Url(input: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < input.length; i += 1) binary += String.fromCharCode(input[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyScopedPayload(token: string): Promise<ScopedPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mcst') return null;
  const [, encoded, signature] = parts;
  const secrets = getScopedSigningSecrets();
  if (secrets.length === 0) return null;

  let validSignature = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
    const expected = toBase64Url(new Uint8Array(sig));
    if (expected === signature) {
      validSignature = true;
      break;
    }
  }
  if (!validSignature) return null;

  try {
    const payloadText = new TextDecoder().decode(fromBase64Url(encoded));
    const payload = JSON.parse(payloadText) as ScopedPayload;
    if (!payload || ![1, 2].includes(payload.v) || !Array.isArray(payload.scopes)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

async function isScopedTokenAuthorized(
  request: NextRequest,
  token: string,
): Promise<{ ok: boolean; invalid?: boolean; required?: string[]; taskId?: string }> {
  const parsed = await verifyScopedPayload(token);
  if (!parsed) return { ok: false, invalid: true };

  const method = request.method.toUpperCase();
  const path = request.nextUrl.pathname;

  if (path === '/api/tasks' && method === 'GET') {
    return hasScope(parsed.scopes, 'tasks:read')
      ? { ok: true }
      : { ok: false, required: ['tasks:read'] };
  }
  if (path === '/api/tasks' && method === 'POST') {
    return hasScope(parsed.scopes, 'tasks:create')
      ? { ok: true }
      : { ok: false, required: ['tasks:create'] };
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(\/.*)?$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    if (!parsed.task_id || parsed.task_id !== taskId) {
      return { ok: false, required: [`task:${taskId}:read`, `task:${taskId}:write`], taskId };
    }
    if (method === 'DELETE') {
      return { ok: false, required: [], taskId };
    }
    const writeMethods = new Set(['POST', 'PATCH', 'PUT']);
    if (writeMethods.has(method)) {
      return hasScope(parsed.scopes, `task:${taskId}:write`)
        ? { ok: true, taskId }
        : { ok: false, required: [`task:${taskId}:write`], taskId };
    }
    return hasScope(parsed.scopes, `task:${taskId}:read`) || hasScope(parsed.scopes, 'tasks:read')
      ? { ok: true, taskId }
      : { ok: false, required: [`task:${taskId}:read`], taskId };
  }

  if (path === '/api/events/stream') {
    return hasScope(parsed.scopes, 'events:read') || hasScope(parsed.scopes, 'tasks:read')
      ? { ok: true }
      : { ok: false, required: ['events:read'] };
  }

  return { ok: false, required: [] };
}

// Demo mode — read-only, blocks all mutations
const STYRMAN_DEMO_MODE = process.env.STYRMAN_DEMO_MODE === 'true';
if (STYRMAN_DEMO_MODE) {
  console.log('[DEMO] Running in demo mode — all write operations are blocked');
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    // Add demo mode header for UI detection
if (STYRMAN_DEMO_MODE) {
      const response = NextResponse.next();
      response.headers.set('X-Demo-Mode', 'true');
      return response;
    }
    return NextResponse.next();
  }

  // Demo mode: block all write operations
if (STYRMAN_DEMO_MODE) {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return NextResponse.json(
        { error: 'Demo mode — this is a read-only instance. Visit github.com/crshdn/mission-control to run your own!' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  // If STYRMAN_API_TOKEN is not set, auth is disabled (dev mode)
  if (!STYRMAN_API_TOKEN) {
    return NextResponse.next();
  }

  // Allow same-origin browser requests (UI fetching its own API)
  if (isSameOriginRequest(request)) {
    return NextResponse.next();
  }

  // Special case: /api/events/stream (SSE) - allow token as query param
  if (pathname === '/api/events/stream') {
    const queryToken = request.nextUrl.searchParams.get('token');
    const scoped = queryToken ? await isScopedTokenAuthorized(request, queryToken) : { ok: false };
  if (queryToken && (queryToken === STYRMAN_API_TOKEN || scoped.ok)) {
      return NextResponse.next();
    }
    // Fall through to header check below
  }

  // Special case: workspace file access with signed token
  // Check Authorization header for bearer token
  const authHeader = request.headers.get('authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (token !== STYRMAN_API_TOKEN) {
    const scoped = await isScopedTokenAuthorized(request, token);
    if (scoped.ok) {
      return NextResponse.next();
    }
    if (scoped.invalid) {
      return NextResponse.json({ error: 'Unauthorized', code: 'invalid_token' }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'Forbidden',
        code: 'insufficient_scope',
        required: scoped.required || [],
        loopback: scoped.taskId
          ? {
              method: 'POST',
              url: `/api/tasks/${scoped.taskId}/fail`,
              body: { reason: `Missing API scope: ${(scoped.required || []).join(', ') || 'operation not allowed'}` },
            }
          : null,
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
