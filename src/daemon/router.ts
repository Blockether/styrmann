import { createLogger } from './logger';
import { getConfig, shouldUseStyrmannToken } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('router');

const RECONNECT_DELAY_MS = 5000;

export function startRouter(config: DaemonConfig, stats: DaemonStats): () => void {
  let abortController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function connect() {
    if (stopped) return;

    const { mcUrl, mcToken } = getConfig();
    const url = `${mcUrl}/api/events/stream${mcToken && shouldUseStyrmannToken(mcUrl) ? `?token=${mcToken}` : ''}`;

    abortController = new AbortController();

    try {
      log.info('Connecting to SSE stream...');
      const res = await fetch(url, {
        signal: abortController.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!res.ok || !res.body) {
        log.warn(`SSE connection failed: ${res.status}`);
        scheduleReconnect();
        return;
      }

      log.info('SSE stream connected');
      stats.lastRouterTick = new Date().toISOString();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data);
            handleEvent(event, stats);
          } catch {
            // Ignore non-JSON SSE data (comments, keepalives)
          }
        }
      }

      log.info('SSE stream ended');
    } catch (err: unknown) {
      if (stopped) return;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (!isAbort) {
        log.warn('SSE connection error, will reconnect');
      }
    }

    if (!stopped) scheduleReconnect();
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  }

  function handleEvent(event: { type?: string; payload?: Record<string, unknown> }, s: DaemonStats) {
    if (!event.type) return;
    s.routedEventCount++;
    s.lastRouterTick = new Date().toISOString();

    switch (event.type) {
      case 'task_updated': {
        const payload = event.payload as { title?: string; status?: string; id?: string } | undefined;
        if (payload?.status === 'assigned') {
          log.info(`Task assigned: "${payload.title}" — dispatcher will pick up`);
        }
        break;
      }
      case 'agent_updated': {
        const payload = event.payload as { name?: string; status?: string } | undefined;
        log.info(`Agent update: ${payload?.name} -> ${payload?.status}`);
        break;
      }
      case 'connected':
        // Initial connection event
        break;
      default:
        // Other events — no action needed
        break;
    }
  }

  // Start connection
  connect();

  return () => {
    stopped = true;
    if (abortController) abortController.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
