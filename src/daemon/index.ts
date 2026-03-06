import { createLogger } from './logger';
import { getConfig } from './bridge';
import { startHeartbeat } from './heartbeat';
import { startDispatcher } from './dispatcher';
import { startScheduler } from './scheduler';
import { startHealthCheck } from './health';
import { startRouter } from './router';
import type { DaemonStats } from './types';

const log = createLogger('daemon');

async function main() {
  const { mcUrl, mcToken } = getConfig();

  if (!mcToken) {
    log.error('MC_API_TOKEN (or MC_TOKEN) is required. Set it as an environment variable.');
    process.exit(1);
  }

  log.info('Starting Mission Control daemon');
  log.info(`MC URL: ${mcUrl}`);

  const stats: DaemonStats = {
    startedAt: Date.now(),
    dispatchedCount: 0,
    heartbeatCount: 0,
    staleRecoveredCount: 0,
    scheduledRunCount: 0,
    scheduledFailureCount: 0,
    routedEventCount: 0,
  };

  const config = {
    mcUrl,
    mcToken,
    heartbeatIntervalMs: 30_000,
    dispatchIntervalMs: 10_000,
    schedulerIntervalMs: 10_000,
  };

  // Start all modules
  const stopHealth = startHealthCheck(config, stats);
  const stopHeartbeat = startHeartbeat(config, stats);
  const stopDispatcher = startDispatcher(config, stats);
  const stopScheduler = startScheduler(config, stats);
  const stopRouter = startRouter(config, stats);

  // Clean shutdown
  const shutdown = () => {
    log.info('Shutting down...');
    stopRouter();
    stopScheduler();
    stopDispatcher();
    stopHeartbeat();
    stopHealth();
    log.info(`Daemon stopped. Stats: dispatched=${stats.dispatchedCount} heartbeats=${stats.heartbeatCount} stale_recovered=${stats.staleRecoveredCount} events_routed=${stats.routedEventCount}`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log.info('All modules started. Press Ctrl+C to stop.');
}

main().catch((err) => {
  log.error('Daemon failed to start:', err);
  process.exit(1);
});
