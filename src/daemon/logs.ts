import { createLogger } from './logger';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('logs');

export function startLogPoller(_config: DaemonConfig, stats: DaemonStats): () => void {
  log.info('Log poller disabled — agents post logs directly via /api/logs/ingest');
  stats.lastLogPollTick = new Date().toISOString();
  return () => {};
}
