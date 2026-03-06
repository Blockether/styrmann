import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('dispatcher');

interface TaskInfo {
  id: string;
  title: string;
  status: string;
  assigned_agent_id?: string;
}

export function startDispatcher(config: DaemonConfig, stats: DaemonStats): () => void {
  async function tick() {
    try {
      const res = await mcFetch('/api/tasks?status=assigned');
      if (!res.ok) {
        log.warn(`Failed to fetch assigned tasks: ${res.status}`);
        return;
      }

      const tasks: TaskInfo[] = await res.json();
      const dispatchable = tasks.filter(t => t.assigned_agent_id);

      stats.lastDispatchTick = new Date().toISOString();

      if (dispatchable.length === 0) return;

      log.info(`Found ${dispatchable.length} assigned task(s) to dispatch`);

      for (const task of dispatchable) {
        try {
          const dispatchRes = await mcFetch(`/api/tasks/${task.id}/dispatch`, {
            method: 'POST',
            body: '{}',
          });

          if (dispatchRes.ok) {
            stats.dispatchedCount++;
            log.info(`Dispatched: "${task.title}" (${task.id})`);
          } else {
            const err = await dispatchRes.json().catch(() => ({}));
            log.warn(`Dispatch failed for "${task.title}": ${(err as { error?: string }).error || dispatchRes.status}`);
          }
        } catch (err) {
          log.error(`Dispatch error for "${task.title}":`, err);
        }
      }
    } catch (err) {
      log.error('Dispatcher tick failed:', err);
    }
  }

  const id = setInterval(tick, config.dispatchIntervalMs);
  // Run first tick after a short delay (let heartbeat run first)
  setTimeout(tick, 2000);
  return () => clearInterval(id);
}
