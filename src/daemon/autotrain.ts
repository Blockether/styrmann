import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('autotrain');

interface AutoTrainTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  assigned_agent_id?: string | null;
  updated_at?: string;
}

interface TaskActivity {
  id: string;
  activity_type: string;
  message: string;
  created_at: string;
}

const DEFAULT_MAX_ITERATIONS = Number.parseInt(process.env.MC_AUTOTRAIN_DEFAULT_MAX_ITERATIONS || '25', 10);
function getMaxIterations(description?: string): number {
  if (!description) return DEFAULT_MAX_ITERATIONS;
  const match = description.match(/MAX_ITERATIONS\s*:\s*(\d+)/i);
  if (!match) return DEFAULT_MAX_ITERATIONS;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITERATIONS;
}

function getControlSignal(activities: TaskActivity[]): 'stop' | 'resume' | null {
  for (const activity of activities) {
    if (/AUTOTRAIN_STOP/i.test(activity.message)) return 'stop';
    if (/AUTOTRAIN_RESUME/i.test(activity.message)) return 'resume';
  }
  return null;
}

function countControlSignals(activities: TaskActivity[]): number {
  return activities.filter(
    (a) => /AUTOTRAIN_(STOP|RESUME)/i.test(a.message)
  ).length;
}

export function startAutoTrain(config: DaemonConfig, stats: DaemonStats): () => void {
  const handledStates = new Map<string, string>();

  async function tick() {
    stats.lastAutoTrainTick = new Date().toISOString();

    try {
      const tasksRes = await mcFetch('/api/tasks?status=done&task_type=autotrain');
      if (!tasksRes.ok) {
        log.warn(`Failed to fetch autotrain tasks: ${tasksRes.status}`);
        return;
      }

      const tasks = (await tasksRes.json()) as AutoTrainTask[];
      for (const task of tasks) {
        const activitiesRes = await mcFetch(`/api/tasks/${task.id}/activities`);
        if (!activitiesRes.ok) {
          log.warn(`Failed to fetch activities for autotrain task ${task.id}`);
          continue;
        }

        const activities = (await activitiesRes.json()) as TaskActivity[];
        const dispatchCount = activities.filter((a) => a.activity_type === 'dispatch_invocation').length;
        const maxIterations = getMaxIterations(task.description);
        const signalCount = countControlSignals(activities);

        // Include signal count in stateKey so RESUME after STOP works
        const stateKey = `${task.status}:${task.updated_at || ''}:${signalCount}`;
        if (handledStates.get(task.id) === stateKey) {
          log.info(`Task ${task.id}: skipping - state already processed (iter=${dispatchCount}/${maxIterations}, signals=${signalCount})`);
          continue;
        }

        log.info(`Task ${task.id}: processing (iter=${dispatchCount}/${maxIterations}, signals=${signalCount}, stateKey=${stateKey})`);

        const controlSignal = getControlSignal(activities);
        if (controlSignal === 'stop' || dispatchCount >= maxIterations) {
          log.info(`Task ${task.id}: stopping - signal=${controlSignal || 'none'}, atMax=${dispatchCount >= maxIterations}`);
          handledStates.set(task.id, stateKey);
          stats.autotrainStoppedCount = (stats.autotrainStoppedCount || 0) + 1;
          await mcFetch(`/api/tasks/${task.id}/activities`, {
            method: 'POST',
            body: JSON.stringify({
              activity_type: 'status_changed',
              message: controlSignal === 'stop'
                ? 'Auto-Train loop stopped by explicit stop signal.'
                : `Auto-Train loop reached max iterations (${maxIterations}).`,
            }),
          }).catch(() => {});
          continue;
        }

        if (!task.assigned_agent_id) {
          handledStates.set(task.id, stateKey);
          log.info(`Task ${task.id}: pausing - no agent assigned`);
          await mcFetch(`/api/tasks/${task.id}/activities`, {
            method: 'POST',
            body: JSON.stringify({
              activity_type: 'status_changed',
              message: 'Auto-Train loop paused because no agent is assigned.',
            }),
          }).catch(() => {});
          continue;
        }

        const nextIteration = dispatchCount + 1;
        const patchRes = await mcFetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'assigned',
            status_reason: `Auto-Train continuing with iteration ${nextIteration}`,
          }),
        });

        if (!patchRes.ok) {
          log.warn(`Failed to restart autotrain task ${task.id}: ${patchRes.status}`);
          continue;
        }

        handledStates.set(task.id, stateKey);
        stats.autotrainIterationsCount = (stats.autotrainIterationsCount || 0) + 1;
        log.info(`Task ${task.id}: restarting iteration ${nextIteration}/${maxIterations}`);
        await mcFetch(`/api/tasks/${task.id}/activities`, {
          method: 'POST',
          body: JSON.stringify({
            activity_type: 'status_changed',
            message: `Auto-Train restarting iteration ${nextIteration}.`,
          }),
        }).catch(() => {});
      }
    } catch (error) {
      log.error('Auto-Train tick failed:', error);
    }
  }

  const initialTimeout = setTimeout(tick, 8000);
  const id = setInterval(tick, config.autotrainIntervalMs);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(id);
  };
}
