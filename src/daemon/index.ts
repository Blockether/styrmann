import { createLogger } from './logger';
import { getConfig, shouldUseStyrmannToken } from './bridge';
import { startHeartbeat } from './heartbeat';
import { startDispatcher } from './dispatcher';
import { startScheduler } from './scheduler';
import { startHealthCheck } from './health';
import { startRouter } from './router';
import { startLogPoller } from './logs';
import { startReporter } from './reporter';
import { startRecovery } from './recovery';
import { startDiscord } from './discord';
import { startSynthesis } from './synthesis';
import type { DaemonStats } from './types';

const log = createLogger('daemon');

async function main() {
  const { mcUrl, mcToken } = getConfig();

  if (shouldUseStyrmannToken(mcUrl) && !mcToken) {
    log.error('STYRMAN_API_TOKEN is required. Set it as an environment variable.');
    process.exit(1);
  }

  log.info('Starting Styrmann daemon');
  log.info(`MC URL: ${mcUrl}`);

  const stats: DaemonStats = {
    startedAt: Date.now(),
    dispatchedCount: 0,
    heartbeatCount: 0,
    staleRecoveredCount: 0,
    scheduledRunCount: 0,
    scheduledFailureCount: 0,
    routedEventCount: 0,
    logEntriesStored: 0,
    logEntriesCleaned: 0,
    stalledRedispatchedCount: 0,
    stalledReassignedCount: 0,
  };

  const config = {
    mcUrl,
    mcToken,
    heartbeatIntervalMs: 30_000,
    dispatchIntervalMs: 10_000,
    schedulerIntervalMs: 10_000,
    logPollIntervalMs: 30_000,
    recoveryIntervalMs: 60_000,
    synthesisIntervalMs: 3_600_000,
  };

  // Start all modules
  const stopHealth = startHealthCheck(config, stats);
  const stopHeartbeat = startHeartbeat(config, stats);
  const stopDispatcher = startDispatcher(config, stats);
  const stopScheduler = startScheduler(config, stats);
  const stopRouter = startRouter(config, stats);
  const stopLogPoller = startLogPoller(config, stats);
  const stopRecovery = startRecovery(config, stats);
  const stopReporter = startReporter(config, stats);
  const stopDiscord = startDiscord(config, stats);
  const stopSynthesis = startSynthesis(config, stats);

  const shutdown = () => {
    log.info('Shutting down...');
    stopSynthesis();
    stopDiscord();
    stopReporter();
    stopRecovery();
    stopLogPoller();
    stopRouter();
    stopScheduler();
    stopDispatcher();
    stopHeartbeat();
    stopHealth();
    log.info(`Daemon stopped. Stats: dispatched=${stats.dispatchedCount} heartbeats=${stats.heartbeatCount} stale_recovered=${stats.staleRecoveredCount} stale_redispatched=${stats.stalledRedispatchedCount || 0} stale_reassigned=${stats.stalledReassignedCount || 0} events_routed=${stats.routedEventCount} logs_stored=${stats.logEntriesStored || 0}`);
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
