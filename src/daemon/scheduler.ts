import { createLogger } from './logger';
import { mcBroadcast } from './bridge';
import type { DaemonConfig, DaemonStats, ScheduledJob } from './types';

const log = createLogger('scheduler');

const registry: ScheduledJob[] = [];
const lastRun: Map<string, number> = new Map();

// Simple interval-based scheduling (no cron parsing)
// cron field is stored for metadata but scheduling uses a fixed interval per job
const CRON_INTERVALS: Record<string, number> = {
  '* * * * *': 60_000,         // every minute
  '*/5 * * * *': 300_000,      // every 5 minutes
  '*/15 * * * *': 900_000,     // every 15 minutes
  '0 * * * *': 3_600_000,      // hourly
  '0 */6 * * *': 21_600_000,   // every 6 hours
  '0 0 * * *': 86_400_000,     // daily
};

function getIntervalMs(cron: string): number {
  return CRON_INTERVALS[cron] || 3_600_000; // default hourly
}

export function registerJob(job: ScheduledJob): void {
  registry.push(job);
  log.info(`Registered job: ${job.name} (${job.id}) cron=${job.cron} enabled=${job.enabled}`);
}

export function startScheduler(config: DaemonConfig, stats: DaemonStats): () => void {
  async function tick() {
    stats.lastSchedulerTick = new Date().toISOString();

    for (const job of registry) {
      if (!job.enabled) continue;

      const interval = getIntervalMs(job.cron);
      const last = lastRun.get(job.id) || 0;
      const now = Date.now();

      if (now - last < interval) continue;

      lastRun.set(job.id, now);
      log.info(`Running job: ${job.name} (${job.id})`);

      try {
        await job.handler();
        stats.scheduledRunCount++;
        await mcBroadcast({
          type: 'scheduled_job_run',
          payload: { job_id: job.id, name: job.name, status: 'completed', finished_at: new Date().toISOString() },
        });
      } catch (err) {
        stats.scheduledFailureCount++;
        log.error(`Job ${job.name} failed:`, err);
        await mcBroadcast({
          type: 'scheduled_job_run',
          payload: { job_id: job.id, name: job.name, status: 'failed', error: String(err), finished_at: new Date().toISOString() },
        });
      }
    }
  }

  const id = setInterval(tick, config.schedulerIntervalMs);
  return () => clearInterval(id);
}
