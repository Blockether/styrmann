import { createLogger } from './logger';

const log = createLogger('bridge');

export function getConfig() {
  return {
    mcUrl: (process.env.MC_URL || process.env.MISSION_CONTROL_PUBLIC_URL || 'https://control.blockether.com').replace(/\/$/, ''),
    mcToken: process.env.MC_API_TOKEN || process.env.MC_TOKEN || '',
  };
}

export function shouldUseMissionControlToken(_mcUrl?: string): boolean {
  return true;
}

export async function mcFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { mcUrl, mcToken } = getConfig();
  const url = `${mcUrl}${path}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (mcToken) {
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
