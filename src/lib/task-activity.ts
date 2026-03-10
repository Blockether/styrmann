import { getDb, queryAll, queryOne } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { summarizeFeedItem as summarizeFeedItemPure, summarizeTaskActivity } from '@/lib/activity-presentation';
import type { Agent, PresentedTaskActivity, Task, TaskActivity } from '@/lib/types';

type ActivityInsert = {
  taskId: string;
  activityType: TaskActivity['activity_type'] | string;
  message: string;
  agentId?: string | null;
  metadata?: Record<string, unknown> | string | null;
};

type RawActivityRow = {
  id: string;
  task_id: string;
  agent_id: string | null;
  activity_type: string;
  message: string;
  metadata: string | null;
  created_at: string;
  agent_name: string | null;
  agent_role: string | null;
  agent_workspace_id: string | null;
};

function parseMetadata(metadata: string | null | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeStep(step: unknown): string | null {
  return typeof step === 'string' && step.trim().length > 0 ? step.trim() : null;
}

function inferWorkflowStep(activityType: string, message: string, metadata: Record<string, unknown> | null, taskStatus?: string | null): string | null {
  const explicit = normalizeStep(metadata?.workflow_step);
  if (explicit) return explicit;

  const lower = `${activityType} ${message}`.toLowerCase();
  if (lower.includes('verification')) return 'verification';
  if (lower.includes('review')) return 'review';
  if (lower.includes('test')) return 'testing';
  if (lower.includes('assigned')) return 'assigned';
  if (lower.includes('dispatch') || lower.includes('build') || lower.includes('implementation')) return 'in_progress';
  return taskStatus || null;
}

function inferDecisionEvent(activityType: string, message: string, metadata: Record<string, unknown> | null): boolean {
  if (metadata && typeof metadata.action === 'string') return true;
  const lower = `${activityType} ${message}`.toLowerCase();
  return lower.includes('dispatch')
    || lower.includes('handoff')
    || lower.includes('failed')
    || lower.includes('accept')
    || lower.includes('reject')
    || lower.includes('verify')
    || lower.includes('review');
}

function presenterMessage(step: string | null, rawActivities: TaskActivity[], currentStep: string | null): { message: string; summaryKind: PresentedTaskActivity['summary_kind'] } {
  const decisionCount = rawActivities.filter((activity) => activity.decision_event).length;
  const summaryParts = rawActivities.slice(0, 3).map((activity) => summarizeTaskActivity(activity));
  const stepLabel = step || 'general';
  const kind: PresentedTaskActivity['summary_kind'] = step === currentStep ? 'live' : 'post_step';
  const prefix = kind === 'live'
    ? `Presenter live summary for ${stepLabel}`
    : `Presenter consolidated ${stepLabel}`;
  const decisionText = decisionCount > 0 ? ` ${decisionCount} decision event(s).` : '';
  return {
    message: `${prefix}: ${summaryParts.join(' ')}${decisionText}`.trim(),
    summaryKind: kind,
  };
}

function rawToTaskActivity(row: RawActivityRow, taskStatus?: string | null): TaskActivity {
  const technicalDetails = parseMetadata(row.metadata);
  return {
    id: row.id,
    task_id: row.task_id,
    agent_id: row.agent_id || undefined,
    activity_type: row.activity_type as TaskActivity['activity_type'],
    message: row.message,
    metadata: row.metadata || undefined,
    created_at: row.created_at,
    workflow_step: inferWorkflowStep(row.activity_type, row.message, technicalDetails, taskStatus),
    decision_event: inferDecisionEvent(row.activity_type, row.message, technicalDetails),
    summary_role: 'system',
    summary_kind: 'raw',
    technical_details: technicalDetails,
    agent: row.agent_id ? {
      id: row.agent_id,
      name: row.agent_name || 'Unknown Agent',
      role: row.agent_role || '',
      status: 'working',
      workspace_id: row.agent_workspace_id || 'default',
      source: 'local',
      description: '',
      created_at: '',
      updated_at: '',
    } : undefined,
  };
}

export function createTaskActivity({ taskId, activityType, message, agentId, metadata }: ActivityInsert): TaskActivity {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task = queryOne<Pick<Task, 'status'>>('SELECT status FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  const baseMetadata = typeof metadata === 'string'
    ? (parseMetadata(metadata) || {})
    : (metadata || {});
  const normalizedMetadata = {
    ...baseMetadata,
    workflow_step: normalizeStep(baseMetadata.workflow_step) || task?.status || null,
    decision_event: typeof baseMetadata.decision_event === 'boolean'
      ? baseMetadata.decision_event
      : inferDecisionEvent(activityType, message, baseMetadata),
  };

  db.prepare(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    taskId,
    agentId || null,
    activityType,
    message,
    JSON.stringify(normalizedMetadata),
    now,
  );

  const row = db.prepare(
    `SELECT a.*, ag.name as agent_name, ag.role as agent_role, ag.workspace_id as agent_workspace_id
     FROM task_activities a
     LEFT JOIN agents ag ON a.agent_id = ag.id
     WHERE a.id = ?`,
  ).get(id) as RawActivityRow;

  const activity = rawToTaskActivity(row, task?.status || null);
  broadcast({ type: 'activity_logged', payload: activity });
  const presented = buildPresentedTaskActivities(taskId, 200, 0).activities[0];
  if (presented) {
    broadcast({ type: 'activity_presented', payload: presented });
  }
  return activity;
}

export function getRawTaskActivities(taskId: string, limit = 200, offset = 0): { activities: TaskActivity[]; total: number } {
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) as total FROM task_activities WHERE task_id = ?').get(taskId) as { total: number };
  const task = queryOne<Pick<Task, 'status' | 'assigned_agent_id'>>('SELECT status, assigned_agent_id FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  const rows = db.prepare(
    `SELECT a.*, ag.name as agent_name, ag.role as agent_role, ag.workspace_id as agent_workspace_id
     FROM task_activities a
     LEFT JOIN agents ag ON a.agent_id = ag.id
     WHERE a.task_id = ?
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(taskId, limit, offset) as RawActivityRow[];

  return {
    activities: rows.map((row) => rawToTaskActivity(row, task?.status || null)),
    total: countRow?.total || 0,
  };
}

export function buildPresentedTaskActivities(taskId: string, limit = 200, offset = 0): {
  activities: PresentedTaskActivity[];
  raw_activities: TaskActivity[];
  total: number;
  filters: {
    agents: Array<{ id: string; name: string }>;
    workflow_steps: string[];
  };
} {
  const task = queryOne<Pick<Task, 'status' | 'assigned_agent_id'>>('SELECT status, assigned_agent_id FROM tasks WHERE id = ? LIMIT 1', [taskId]);
  const presenter = queryOne<Agent>(
    `SELECT * FROM agents
     WHERE role = 'presenter' AND (workspace_id = (SELECT workspace_id FROM tasks WHERE id = ?) OR workspace_id = 'default')
     ORDER BY CASE WHEN workspace_id = (SELECT workspace_id FROM tasks WHERE id = ?) THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
    [taskId, taskId],
  );
  const { activities: rawActivities, total } = getRawTaskActivities(taskId, limit, offset);
  const grouped = new Map<string, TaskActivity[]>();

  for (const activity of [...rawActivities].reverse()) {
    const key = activity.workflow_step || 'general';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(activity);
  }

  const presented: PresentedTaskActivity[] = [];
  for (const [step, stepActivities] of grouped.entries()) {
    const summary = presenterMessage(step, [...stepActivities].reverse(), task?.status || null);
    presented.unshift({
      id: `presenter-${taskId}-${step}`,
      task_id: taskId,
      activity_type: 'activity_summary',
      summary_role: 'presenter',
      summary_kind: summary.summaryKind,
      message: summary.message,
      created_at: stepActivities[stepActivities.length - 1]?.created_at || new Date().toISOString(),
      workflow_step: step,
      decision_event: stepActivities.some((activity) => activity.decision_event),
      technical_details: {
        raw_activity_ids: stepActivities.map((activity) => activity.id),
        raw_count: stepActivities.length,
      },
      agent_id: presenter?.id,
      agent: presenter ? presenter : undefined,
      raw_activities: [...stepActivities].reverse(),
    });
  }

  const filters = {
    agents: Array.from(new Map(rawActivities
      .filter((activity) => activity.agent?.id)
      .map((activity) => [activity.agent!.id, { id: activity.agent!.id, name: activity.agent!.name }])).values()),
    workflow_steps: Array.from(new Set(rawActivities.map((activity) => activity.workflow_step).filter((step): step is string => Boolean(step)))),
  };

  return { activities: presented, raw_activities: rawActivities, total, filters };
}

export function summarizeFeedItem(message: string, metadata: Record<string, unknown> | null, source: 'activity' | 'agent_log', activityType: string | null): string {
  return summarizeFeedItemPure(message, metadata, source, activityType);
}
