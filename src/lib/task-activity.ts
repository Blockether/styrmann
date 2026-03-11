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

function hasCriticalTransitionSignal(activity: TaskActivity): boolean {
  const lower = `${activity.activity_type} ${activity.message}`.toLowerCase();
  const details = (activity.technical_details && typeof activity.technical_details === 'object')
    ? activity.technical_details as Record<string, unknown>
    : null;

  if (
    lower.includes('fail')
    || lower.includes('error')
    || lower.includes('retry')
    || lower.includes('rejected')
    || lower.includes('loopback')
  ) {
    return true;
  }

  if (!details) return false;
  return Boolean(
    details.fail_reason
    || details.fail_target
    || details.dispatch_error
    || details.retry_error
    || details.planning_dispatch_error
    || details.status_reason
  );
}

function consolidateStepActivities(rawActivities: TaskActivity[]): TaskActivity[] {
  if (rawActivities.length <= 1) return rawActivities;

  const consolidated: TaskActivity[] = [];
  let i = 0;

  while (i < rawActivities.length) {
    const current = rawActivities[i];

    // Merge consecutive same-type activities from same agent (e.g., multiple status_changed or updated)
    if (i + 1 < rawActivities.length
      && current.activity_type === rawActivities[i + 1].activity_type
      && current.agent_id === rawActivities[i + 1].agent_id
      && current.activity_type !== 'dispatch_invocation'
      && current.activity_type !== 'completed'
      && !hasCriticalTransitionSignal(current)
      && !hasCriticalTransitionSignal(rawActivities[i + 1])
    ) {
      // Skip the duplicate, keep the later one (more recent info)
      i++;
      continue;
    }

    // Deduplicate status_changed chains — keep only the final state transition
    if (current.activity_type === 'status_changed' && i + 1 < rawActivities.length) {
      let j = i + 1;
      while (j < rawActivities.length && rawActivities[j].activity_type === 'status_changed') {
        j++;
      }
      if (j > i + 1) {
        const chain = rawActivities.slice(i, j);
        const critical = chain.filter(hasCriticalTransitionSignal);

        if (critical.length > 0) {
          const selected = new Map<string, TaskActivity>();
          for (const item of critical) selected.set(item.id, item);
          const last = chain[chain.length - 1];
          selected.set(last.id, last);
          for (const item of chain) {
            if (selected.has(item.id)) consolidated.push(item);
          }
        } else {
          consolidated.push(chain[chain.length - 1]);
        }
        i = j;
        continue;
      }
    }

    consolidated.push(current);
    i++;
  }

  return consolidated;
}

function presenterMessage(step: string | null, rawActivities: TaskActivity[], currentStep: string | null): { message: string; summaryKind: PresentedTaskActivity['summary_kind']; consolidatedActivities: TaskActivity[] } {
  const kind: PresentedTaskActivity['summary_kind'] = step === currentStep ? 'live' : 'post_step';
  const stepLabel = step || 'general';

  // Post-step consolidation: merge and deduplicate events
  const consolidated = kind === 'post_step'
    ? consolidateStepActivities(rawActivities)
    : rawActivities;

  const decisionCount = consolidated.filter((a) => a.decision_event).length;
  const uniqueSummaries = new Map<string, string>();

  const summaryBudget = 5;
  const critical = consolidated.filter(hasCriticalTransitionSignal);
  const nonCritical = consolidated.filter((activity) => !hasCriticalTransitionSignal(activity));
  const prioritized = [
    ...critical.slice(0, summaryBudget),
    ...nonCritical.slice(0, Math.max(0, summaryBudget - critical.length)),
  ];

  for (const activity of prioritized) {
    const summary = summarizeTaskActivity(activity);
    if (!uniqueSummaries.has(summary)) {
      uniqueSummaries.set(summary, summary);
    }
  }

  const summaryText = Array.from(uniqueSummaries.values()).join(' ');
  const decisionText = decisionCount > 0 ? ` ${decisionCount} decision event(s).` : '';
  const criticalText = critical.length > 0 ? ` ${critical.length} failure/retry signal(s).` : '';

  const prefix = kind === 'live'
    ? `[${stepLabel}]`
    : `[${stepLabel} completed]`;

  return {
    message: `${prefix} ${summaryText}${decisionText}${criticalText}`.trim(),
    summaryKind: kind,
    consolidatedActivities: consolidated,
  };
}

function isFailureActivity(activity: TaskActivity): boolean {
  if (hasCriticalTransitionSignal(activity)) return true;
  const lower = `${activity.activity_type} ${activity.message}`.toLowerCase();
  return lower.includes('fail') || lower.includes('error') || lower.includes('retry');
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
    `SELECT a.*, ag.name as agent_name, ag.role as agent_role
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
    `SELECT a.*, ag.name as agent_name, ag.role as agent_role
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
     WHERE role = 'presenter'
     ORDER BY created_at ASC
     LIMIT 1`,
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
    const activitiesChronological = [...stepActivities].reverse();
    const summary = presenterMessage(step, activitiesChronological, task?.status || null);
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
        consolidated_count: summary.consolidatedActivities.length,
      },
      agent_id: presenter?.id,
      agent: presenter ? presenter : undefined,
      // Expose consolidated view, but keep all raw activities for full technical access
      raw_activities: activitiesChronological,
    });
  }

  const rawFailures = rawActivities.filter(isFailureActivity);
  if (rawFailures.length > 0) {
    const uniqueFailureTexts = Array.from(new Set(
      rawFailures
        .map((item) => summarizeTaskActivity(item).trim())
        .filter((item) => item.length > 0),
    ));
    const preview = uniqueFailureTexts.slice(0, 3).join(' ');
    const failureSummary = `[failure signals] ${preview}${rawFailures.length > 3 ? ` (+${rawFailures.length - 3} more)` : ''}`.trim();
    presented.unshift({
      id: `presenter-${taskId}-failure-signals`,
      task_id: taskId,
      activity_type: 'activity_summary',
      summary_role: 'presenter',
      summary_kind: 'post_step',
      message: failureSummary,
      created_at: rawFailures[0]?.created_at || new Date().toISOString(),
      workflow_step: 'failure',
      decision_event: true,
      technical_details: {
        raw_activity_ids: rawFailures.map((item) => item.id),
        raw_count: rawFailures.length,
        consolidated_count: rawFailures.length,
      },
      agent_id: presenter?.id,
      agent: presenter ? presenter : undefined,
      raw_activities: rawFailures,
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

/**
 * Build workspace-level presenter summaries across recent active tasks.
 * Returns one presented summary per task, showing the latest workflow step.
 */
export function buildWorkspaceActivitySummary(workspaceId: string, limit = 10): {
  summaries: Array<{
    task_id: string;
    task_title: string;
    task_status: string;
    assigned_agent_name: string | null;
    summary: PresentedTaskActivity;
  }>;
} {
  const db = getDb();
  const tasks = db.prepare(
    `SELECT t.id, t.title, t.status, a.name as agent_name
     FROM tasks t
     LEFT JOIN agents a ON t.assigned_agent_id = a.id
     WHERE t.workspace_id = ? AND t.status != 'done'
     ORDER BY t.updated_at DESC
     LIMIT ?`
  ).all(workspaceId, limit) as Array<{ id: string; title: string; status: string; agent_name: string | null }>;

  const summaries: Array<{
    task_id: string;
    task_title: string;
    task_status: string;
    assigned_agent_name: string | null;
    summary: PresentedTaskActivity;
  }> = [];

  for (const task of tasks) {
    const result = buildPresentedTaskActivities(task.id, 50, 0);
    // Take the most recent (first) presented activity as the task summary
    const latest = result.activities[0];
    if (latest) {
      summaries.push({
        task_id: task.id,
        task_title: task.title,
        task_status: task.status,
        assigned_agent_name: task.agent_name,
        summary: latest,
      });
    }
  }

  return { summaries };
}
