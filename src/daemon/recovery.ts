import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('recovery');

interface TaskInfo {
  id: string;
  title: string;
  status: string;
  assigned_agent_id?: string | null;
  workspace_id: string;
  updated_at?: string;
}

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: string;
  workspace_id: string;
}

interface ActiveSessionInfo {
  session_id?: string;
  task_id?: string | null;
  agent_id?: string | null;
  status?: string;
  updated_at?: string;
}

const STALLED_TASK_THRESHOLD_MS = Number.parseInt(process.env.MC_STALLED_TASK_THRESHOLD_MS || '1200000', 10);
const STALLED_TASK_COOLDOWN_MS = Number.parseInt(process.env.MC_STALLED_TASK_COOLDOWN_MS || '600000', 10);
const RECOVERABLE_TASK_STATUSES = ['assigned', 'in_progress', 'testing', 'verification', 'review'] as const;

function getStatusThresholdMs(status: string): number {
  const normalized = status.toLowerCase();
  if (normalized === 'in_progress' || normalized === 'assigned') {
    return STALLED_TASK_THRESHOLD_MS;
  }
  return Math.max(STALLED_TASK_THRESHOLD_MS, 20 * 60 * 1000);
}

type RecoveryState = {
  lastActionAt: number;
};

function parseUpdatedAtMs(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldSkipByCooldown(state: Map<string, RecoveryState>, taskId: string, nowMs: number): boolean {
  const existing = state.get(taskId);
  if (!existing) return false;
  return nowMs - existing.lastActionAt < STALLED_TASK_COOLDOWN_MS;
}

async function logRecoveryActivity(taskId: string, message: string): Promise<void> {
  try {
    await mcFetch(`/api/tasks/${taskId}/activities`, {
      method: 'POST',
      body: JSON.stringify({
        activity_type: 'status_changed',
        message,
      }),
    });
  } catch (err) {
    log.warn(`Failed to log recovery activity for ${taskId}: ${String(err)}`);
  }
}

async function reassignTask(taskId: string, agentId: string): Promise<boolean> {
  const res = await mcFetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      assigned_agent_id: agentId,
      status: 'assigned',
    }),
  });

  return res.ok;
}



export function startRecovery(config: DaemonConfig, stats: DaemonStats): () => void {
  const recoveryState = new Map<string, RecoveryState>();

  async function tick() {
    const nowMs = Date.now();
    stats.lastRecoveryTick = new Date(nowMs).toISOString();

    try {
      const [taskResponses, agentsRes] = await Promise.all([
        Promise.all(RECOVERABLE_TASK_STATUSES.map((status) => mcFetch(`/api/tasks?status=${status}`))),
        mcFetch('/api/agents'),
      ]);

      const failedTaskResponse = taskResponses.find((res) => !res.ok);
      if (failedTaskResponse) {
        log.warn(`Failed to fetch recoverable tasks for recovery: ${failedTaskResponse.status}`);
        return;
      }

      if (!agentsRes.ok) {
        log.warn(`Failed to fetch agents for recovery: ${agentsRes.status}`);
        return;
      }

      const tasksByStatus = await Promise.all(taskResponses.map(async (res) => {
        const payload = await res.json();
        return Array.isArray(payload) ? (payload as TaskInfo[]) : [];
      }));
      const tasks = Array.from(
        new Map(tasksByStatus.flat().map((task) => [task.id, task])).values(),
      );
      const agentsRaw = await agentsRes.json();
      const agents = Array.isArray(agentsRaw) ? (agentsRaw as AgentInfo[]) : [];
      const latestSessionUpdateByTask = new Map<string, number>();

      if (tasks.length === 0) return;

      for (const task of tasks) {
        if (!task.assigned_agent_id) continue;
        if (!RECOVERABLE_TASK_STATUSES.includes(task.status as (typeof RECOVERABLE_TASK_STATUSES)[number])) continue;

        const taskUpdatedAtMs = parseUpdatedAtMs(task.updated_at);
        const sessionUpdatedAtMs = latestSessionUpdateByTask.get(task.id) || 0;
        const updatedAtMs = Math.max(taskUpdatedAtMs, sessionUpdatedAtMs);
        const staleThresholdMs = getStatusThresholdMs(task.status);
        if (!updatedAtMs || nowMs - updatedAtMs < staleThresholdMs) continue;
        if (shouldSkipByCooldown(recoveryState, task.id, nowMs)) continue;

        const ageMinutes = Math.round((nowMs - updatedAtMs) / 60000);
        const assignedAgent = agents.find((agent) => agent.id === task.assigned_agent_id);

        if (!assignedAgent || assignedAgent.status === 'offline') {
          const orchestrator = agents.find(
            (agent) => agent.role === 'orchestrator' && agent.status !== 'offline',
          );

          if (orchestrator && orchestrator.id !== task.assigned_agent_id) {
            const ok = await reassignTask(task.id, orchestrator.id);
            if (ok) {
              stats.stalledReassignedCount = (stats.stalledReassignedCount || 0) + 1;
              recoveryState.set(task.id, { lastActionAt: nowMs });
              await logRecoveryActivity(
                task.id,
                `[Auto-Recovery] Reassigned stale task after ${ageMinutes}m to orchestrator ${orchestrator.name}.`,
              );
              log.info(`Reassigned stale task ${task.id} to orchestrator ${orchestrator.name}`);
            } else {
              log.warn(`Failed to reassign stale task ${task.id}`);
            }
          } else {
            recoveryState.set(task.id, { lastActionAt: nowMs });
            await logRecoveryActivity(
              task.id,
              `[Auto-Recovery] Task stale for ${ageMinutes}m but orchestrator is unavailable.`,
            );
            log.warn(`Stale task ${task.id} — orchestrator unavailable`);
          }

          continue;
        }

        const dispatchRes = await mcFetch(`/api/tasks/${task.id}/dispatch`, {
          method: 'POST',
          body: '{}',
        });

        if (dispatchRes.ok) {
          stats.stalledRedispatchedCount = (stats.stalledRedispatchedCount || 0) + 1;
          recoveryState.set(task.id, { lastActionAt: nowMs });
          await logRecoveryActivity(
            task.id,
            `[Auto-Recovery] Re-dispatched stale task to ${assignedAgent.name} after ${ageMinutes}m without updates.`,
          );
          log.info(`Re-dispatched stale task ${task.id} to ${assignedAgent.name}`);
          continue;
        }

        if (dispatchRes.status === 409) {
          recoveryState.set(task.id, { lastActionAt: nowMs });
          await logRecoveryActivity(
            task.id,
            `[Auto-Recovery] Dispatch blocked (409) for stale task — likely dependency or stage gate.`,
          );
          log.warn(`Recovery dispatch blocked (409) for ${task.id}`);
          continue;
        }

        log.warn(`Recovery dispatch failed for ${task.id}: ${dispatchRes.status}`);
      }
    } catch (err) {
      log.error('Recovery tick failed:', err);
    }
  }

  const id = setInterval(tick, config.recoveryIntervalMs);
  const initialTimeout = setTimeout(tick, 5000);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(id);
  };
}
