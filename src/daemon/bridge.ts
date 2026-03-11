import { createLogger } from './logger';

const log = createLogger('bridge');

function isLocalMissionControlUrl(mcUrl: string): boolean {
  try {
    const parsed = new URL(mcUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

export function getConfig() {
  return {
    mcUrl: (process.env.MC_URL || 'http://localhost:4000').replace(/\/$/, ''),
    mcToken: process.env.MC_API_TOKEN || process.env.MC_TOKEN || '',
  };
}

export function shouldUseMissionControlToken(mcUrl: string): boolean {
  return !isLocalMissionControlUrl(mcUrl);
}

export async function mcFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { mcUrl, mcToken } = getConfig();
  const url = `${mcUrl}${path}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (mcToken && shouldUseMissionControlToken(mcUrl)) {
    headers['Authorization'] = `Bearer ${mcToken}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

export async function mcBroadcast(event: { type: string; payload: unknown }): Promise<void> {
  try {
    const res = await mcFetch('/api/events/broadcast', {
      method: 'POST',
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      log.warn(`Broadcast failed (${res.status}): ${event.type}`);
    }
  } catch (err) {
    log.error('Broadcast error:', err);
  }
}
