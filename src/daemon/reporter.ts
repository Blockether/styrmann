import { createLogger } from './logger';
import { mcFetch } from './bridge';
import { getRegisteredJobs } from './scheduler';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('reporter');

/**
 * Stats reporter module.
 *
 * Periodically pushes the daemon's in-memory stats snapshot to Mission Control
 * via POST /api/daemon/stats. MC stores the latest snapshot and serves it to
 * the UI via GET /api/daemon/stats.
 *
 * Includes: all DaemonStats counters, registered scheduled jobs, process memory,
 * and module interval metadata.
 */
export function startReporter(config: DaemonConfig, stats: DaemonStats): () => void {
  async function tick() {
    try {
      const mem = process.memoryUsage();
      const uptimeSeconds = Math.round((Date.now() - stats.startedAt) / 1000);

      const payload = {
        // Timing
        started_at: new Date(stats.startedAt).toISOString(),
        reported_at: new Date().toISOString(),
        uptime_seconds: uptimeSeconds,
        // Module ticks
        last_heartbeat_tick: stats.lastHeartbeatTick,
        last_dispatch_tick: stats.lastDispatchTick,
        last_scheduler_tick: stats.lastSchedulerTick,
        last_log_poll_tick: stats.lastLogPollTick,
        last_recovery_tick: stats.lastRecoveryTick,
        // Counters
        dispatched_count: stats.dispatchedCount,
        heartbeat_count: stats.heartbeatCount,
        stale_recovered_count: stats.staleRecoveredCount,
        scheduled_run_count: stats.scheduledRunCount,
        scheduled_failure_count: stats.scheduledFailureCount,
        routed_event_count: stats.routedEventCount,
        log_entries_stored: stats.logEntriesStored || 0,
        log_entries_cleaned: stats.logEntriesCleaned || 0,
        stalled_redispatched_count: stats.stalledRedispatchedCount || 0,
        stalled_reassigned_count: stats.stalledReassignedCount || 0,
        // Process
        memory_mb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
        pid: process.pid,
        // Modules with intervals
        modules: [
          { name: 'health', interval_ms: 60_000, last_tick: undefined },
          { name: 'heartbeat', interval_ms: config.heartbeatIntervalMs, last_tick: stats.lastHeartbeatTick },
          { name: 'dispatcher', interval_ms: config.dispatchIntervalMs, last_tick: stats.lastDispatchTick },
          { name: 'scheduler', interval_ms: config.schedulerIntervalMs, last_tick: stats.lastSchedulerTick },
          { name: 'router', interval_ms: 0, last_tick: undefined },  // continuous SSE
          { name: 'log_poller', interval_ms: config.logPollIntervalMs, last_tick: stats.lastLogPollTick },
          { name: 'recovery', interval_ms: config.recoveryIntervalMs, last_tick: stats.lastRecoveryTick },
          { name: 'reporter', interval_ms: 30_000, last_tick: new Date().toISOString() },
        ],
        // Registered scheduled jobs
        jobs: getRegisteredJobs(),
      };

      const res = await mcFetch('/api/daemon/stats', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        log.warn(`Stats push failed (${res.status})`);
      }
    } catch (err) {
      // Silently ignore — MC may be restarting
      log.warn('Stats push error:', err);
    }
  }

  // First push after 5s (let other modules start first)
  const initialTimeout = setTimeout(tick, 5000);

  // Then every 30s
  const id = setInterval(tick, 30_000);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(id);
  };
}
