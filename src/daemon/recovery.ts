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

const STALLED_TASK_THRESHOLD_MS = Number.parseInt(process.env.MC_STALLED_TASK_THRESHOLD_MS || '1800000', 10);
const STALLED_TASK_COOLDOWN_MS = Number.parseInt(process.env.MC_STALLED_TASK_COOLDOWN_MS || '600000', 10);

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
      const [tasksRes, agentsRes] = await Promise.all([
        mcFetch('/api/tasks?status=in_progress'),
        mcFetch('/api/agents'),
      ]);

      if (!tasksRes.ok) {
        log.warn(`Failed to fetch in_progress tasks for recovery: ${tasksRes.status}`);
        return;
      }

      if (!agentsRes.ok) {
        log.warn(`Failed to fetch agents for recovery: ${agentsRes.status}`);
        return;
      }

      const tasksRaw = await tasksRes.json();
      const agentsRaw = await agentsRes.json();
      const tasks = Array.isArray(tasksRaw) ? (tasksRaw as TaskInfo[]) : [];
      const agents = Array.isArray(agentsRaw) ? (agentsRaw as AgentInfo[]) : [];

      if (tasks.length === 0) return;

      for (const task of tasks) {
        if (!task.assigned_agent_id) continue;
        if (task.status !== 'in_progress') continue;

        const updatedAtMs = parseUpdatedAtMs(task.updated_at);
        if (!updatedAtMs || nowMs - updatedAtMs < STALLED_TASK_THRESHOLD_MS) continue;
        if (shouldSkipByCooldown(recoveryState, task.id, nowMs)) continue;

        const ageMinutes = Math.round((nowMs - updatedAtMs) / 60000);
        const assignedAgent = agents.find((agent) => agent.id === task.assigned_agent_id);

        if (!assignedAgent || assignedAgent.status === 'offline') {
          const fallback = agents.find(
            (agent) =>
              agent.workspace_id === task.workspace_id &&
              agent.role === 'orchestrator' &&
              agent.status !== 'offline' &&
              agent.id !== task.assigned_agent_id,
          );

          if (fallback) {
            const ok = await reassignTask(task.id, fallback.id);
            if (ok) {
              stats.stalledReassignedCount = (stats.stalledReassignedCount || 0) + 1;
              recoveryState.set(task.id, { lastActionAt: nowMs });
              await logRecoveryActivity(
                task.id,
                `[Auto-Recovery] Reassigned stale task after ${ageMinutes}m without updates to ${fallback.name}.`,
              );
              log.info(`Reassigned stale task ${task.id} to ${fallback.name}`);
            } else {
              log.warn(`Failed to reassign stale task ${task.id}`);
            }
          } else {
            recoveryState.set(task.id, { lastActionAt: nowMs });
            await logRecoveryActivity(
              task.id,
              `[Auto-Recovery] Task stale for ${ageMinutes}m but no fallback orchestrator is available.`,
            );
            log.warn(`Stale task ${task.id} has no fallback orchestrator`);
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
          const payload = (await dispatchRes.json().catch(() => ({}))) as {
            otherOrchestrators?: Array<{ id: string; name: string }>;
          };
          const fallback = payload.otherOrchestrators?.[0];

          if (fallback) {
            const ok = await reassignTask(task.id, fallback.id);
            if (ok) {
              stats.stalledReassignedCount = (stats.stalledReassignedCount || 0) + 1;
              recoveryState.set(task.id, { lastActionAt: nowMs });
              await logRecoveryActivity(
                task.id,
                `[Auto-Recovery] Reassigned stale task to ${fallback.name} after dispatch conflict.`,
              );
              log.info(`Reassigned stale task ${task.id} to alternate orchestrator ${fallback.name}`);
            }
          }
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
