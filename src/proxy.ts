import { NextRequest, NextResponse } from 'next/server';
import { validateFileToken } from '@/lib/file-tokens';

// Log warning at startup if auth is disabled
const MC_API_TOKEN = process.env.MC_API_TOKEN;
if (!MC_API_TOKEN) {
  console.warn('[SECURITY WARNING] MC_API_TOKEN not set - API authentication is DISABLED (local dev mode)');
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

function isLocalhostRequest(request: NextRequest): boolean {
  const forwardedFor = (request.headers.get('x-forwarded-for') || '').trim();
  const realIp = (request.headers.get('x-real-ip') || '').trim();

  const isLocal = (value: string): boolean =>
    value === '127.0.0.1' || value === '::1' || value.startsWith('127.');

  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim() || '';
    if (isLocal(firstHop)) return true;
  }

  if (realIp && isLocal(realIp)) {
    return true;
  }

  return !forwardedFor && !realIp;
}

// Demo mode — read-only, blocks all mutations
const DEMO_MODE = process.env.DEMO_MODE === 'true';
if (DEMO_MODE) {
  console.log('[DEMO] Running in demo mode — all write operations are blocked');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes
  if (!pathname.startsWith('/api/')) {
    // Add demo mode header for UI detection
    if (DEMO_MODE) {
      const response = NextResponse.next();
      response.headers.set('X-Demo-Mode', 'true');
      return response;
    }
    return NextResponse.next();
  }

  // Demo mode: block all write operations
  if (DEMO_MODE) {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return NextResponse.json(
        { error: 'Demo mode — this is a read-only instance. Visit github.com/crshdn/mission-control to run your own!' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  // If MC_API_TOKEN is not set, auth is disabled (dev mode)
  if (!MC_API_TOKEN) {
    return NextResponse.next();
  }

  // Allow same-origin browser requests (UI fetching its own API)
  if (isSameOriginRequest(request)) {
    return NextResponse.next();
  }

  // Allow local machine service-to-service traffic (daemon/agents)
  if (isLocalhostRequest(request)) {
    return NextResponse.next();
  }

  // Special case: /api/events/stream (SSE) - allow token as query param
  if (pathname === '/api/events/stream') {
    const queryToken = request.nextUrl.searchParams.get('token');
    if (queryToken && queryToken === MC_API_TOKEN) {
      return NextResponse.next();
    }
    // Fall through to header check below
  }

  // Special case: workspace file access with signed token
  const workspaceFileMatch = pathname.match(/^\/api\/agents\/([^/]+)\/workspace\/file$/);
  if (workspaceFileMatch) {
    const fileToken = request.nextUrl.searchParams.get('token');
    const expires = request.nextUrl.searchParams.get('expires');
    if (fileToken && expires) {
      const agentId = workspaceFileMatch[1];
      const scope = request.nextUrl.searchParams.get('scope') || 'workspace';
      const filePath = request.nextUrl.searchParams.get('path') || '';
      if (validateFileToken(fileToken, expires, agentId, scope, filePath)) {
        return NextResponse.next();
      }
    }
    // Fall through to header check below
  }

  // Check Authorization header for bearer token
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  if (token !== MC_API_TOKEN) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
