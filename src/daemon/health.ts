import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('health');

export function startHealthCheck(config: DaemonConfig, stats: DaemonStats): () => void {
  let lastOnline = false;

  async function tick() {
    stats.lastHealthTick = new Date().toISOString();
    try {
      const res = await mcFetch('/api/openclaw/status');
      const online = res.ok;

      if (online !== lastOnline) {
        if (online) {
          log.info('Mission Control is reachable');
        } else {
          log.warn(`Mission Control unreachable (${res.status})`);
        }
        lastOnline = online;
      }
    } catch (err) {
      if (lastOnline) {
        log.error('Mission Control connection lost:', err);
        lastOnline = false;
      }
    }
  }

  // Run immediately
  tick();
  const id = setInterval(tick, 60_000);

  return () => clearInterval(id);
}

export function getHealthStatus(stats: DaemonStats) {
  const uptimeMs = Date.now() - stats.startedAt;
  const uptimeMin = Math.round(uptimeMs / 60_000);
  return {
    uptime: `${uptimeMin}m`,
    ...stats,
    startedAt: new Date(stats.startedAt).toISOString(),
  };
}
