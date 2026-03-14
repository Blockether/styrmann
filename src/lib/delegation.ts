import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { createTaskActivity } from '@/lib/task-activity';
import { isLlmAvailable, llmJsonInfer } from '@/lib/llm';
import type { OrgTicket, OrgTicketType, Task, TaskPriority, TaskType, Workspace } from '@/lib/types';

export interface DelegationResult {
  success: boolean;
  task_ids: string[];
  error?: string;
  llm_used: boolean;
}

interface DelegationTaskSpec {
  workspace_id?: string;
  title?: string;
  description?: string;
  task_type?: string;
  priority?: string;
  effort?: number;
  impact?: number;
  acceptance_criteria?: string[];
}

interface DelegationPlan {
  tasks: DelegationTaskSpec[];
}

interface DelegationOptions {
  workspaceId?: string;
}

type OrgTicketRow = OrgTicket;
type WorkspaceRow = Workspace & { organization_id: string; is_internal?: number | null };

const TASK_TYPE_MAP: Record<OrgTicketType, TaskType> = {
  feature: 'feature',
  bug: 'bug',
  improvement: 'feature',
  task: 'chore',
  epic: 'feature',
};

const ALLOWED_TASK_TYPES = new Set<TaskType>(['bug', 'feature', 'chore', 'documentation', 'research', 'spike']);
const ALLOWED_PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

function normalizeTaskType(value: string | undefined, fallback: TaskType): TaskType {
  if (!value) return fallback;
  return ALLOWED_TASK_TYPES.has(value as TaskType) ? (value as TaskType) : fallback;
}

function normalizePriority(value: string | undefined, fallback: TaskPriority): TaskPriority {
  if (!value) return fallback;
  return ALLOWED_PRIORITIES.has(value as TaskPriority) ? (value as TaskPriority) : fallback;
}

function clampScore(value: number | undefined, fallback = 3): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function buildFallbackPlan(ticket: OrgTicketRow, workspace: WorkspaceRow): DelegationPlan {
  return {
    tasks: [
      {
        workspace_id: workspace.id,
        title: ticket.title,
        description: ticket.description || ticket.title,
        task_type: TASK_TYPE_MAP[ticket.ticket_type] || 'feature',
        priority: ticket.priority,
        effort: 3,
        impact: 3,
        acceptance_criteria: ['Implement the requirements described in this org ticket'],
      },
    ],
  };
}

async function buildDelegationPlan(ticket: OrgTicketRow, workspace: WorkspaceRow): Promise<{ plan: DelegationPlan; llmUsed: boolean }> {
  if (!isLlmAvailable()) {
    return { plan: buildFallbackPlan(ticket, workspace), llmUsed: false };
  }

  const systemPrompt = [
    'You are an orchestration planner that converts business org tickets into implementation tasks.',
    'Return ONLY valid JSON with shape: {"tasks": [{...}]}.',
    'Create 1 to 3 tasks max.',
    'Each task must include: workspace_id, title, description, task_type, priority, effort, impact, acceptance_criteria.',
    'task_type must be one of: feature, bug, chore, documentation, research, spike.',
    'priority must be one of: low, normal, high, urgent.',
    'effort and impact must be integers from 1 to 5.',
    'acceptance_criteria must be an array of short, testable criteria strings.',
  ].join(' ');

  const userPrompt = [
    'Delegate this org ticket into workspace tasks.',
    `Org ticket title: ${ticket.title}`,
    `Org ticket description: ${ticket.description || '(no description)'}`,
    `Org ticket priority: ${ticket.priority}`,
    `Org ticket type: ${ticket.ticket_type}`,
    `External ref: ${ticket.external_ref || '(none)'}`,
    `Target workspace: ${workspace.name} (${workspace.id})`,
    'All tasks should be assigned to this workspace unless strictly necessary otherwise.',
  ].join('\n');

  try {
    const result = await llmJsonInfer<DelegationPlan>(systemPrompt, userPrompt);
    if (result && Array.isArray(result.tasks) && result.tasks.length > 0) {
      return {
        plan: {
          tasks: result.tasks.slice(0, 3),
        },
        llmUsed: true,
      };
    }
  } catch (error) {
    console.warn('[Delegation] LLM planning failed, fallback activated:', error);
  }

  return { plan: buildFallbackPlan(ticket, workspace), llmUsed: false };
}

export async function delegateOrgTicket(ticketId: string, options?: DelegationOptions): Promise<DelegationResult> {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM org_tickets WHERE id = ? LIMIT 1').get(ticketId) as OrgTicketRow | undefined;

  if (!ticket) {
    return { success: false, task_ids: [], error: 'Org ticket not found', llm_used: false };
  }

  const workspaces = db.prepare(
    `SELECT *
     FROM workspaces
     WHERE organization_id = ?
       AND COALESCE(is_internal, 0) = 0
     ORDER BY name ASC`,
  ).all(ticket.organization_id) as WorkspaceRow[];

  if (workspaces.length === 0) {
    return {
      success: false,
      task_ids: [],
      error: 'No workspaces found for this organization',
      llm_used: false,
    };
  }

  const targetWorkspace = options?.workspaceId
    ? (workspaces.find((workspace) => workspace.id === options.workspaceId) || workspaces[0])
    : workspaces[0];

  const { plan, llmUsed } = await buildDelegationPlan(ticket, targetWorkspace);
  const createdTaskIds: string[] = [];
  const now = new Date().toISOString();
  const fallbackTaskType = TASK_TYPE_MAP[ticket.ticket_type] || 'feature';

  const tx = db.transaction(() => {
    // Atomic status update — prevents race condition where two concurrent requests delegate the same ticket
    const statusUpdate = db.prepare(`
      UPDATE org_tickets
      SET status = 'delegated', updated_at = ?
      WHERE id = ? AND status NOT IN ('delegated', 'in_progress', 'resolved', 'closed')
    `).run(now, ticketId);

    if (statusUpdate.changes === 0) {
      throw new Error('ALREADY_DELEGATED');
    }

    for (const rawTask of plan.tasks) {
      const taskId = uuidv4();
      const workspaceId = rawTask.workspace_id || targetWorkspace.id;
      const taskType = normalizeTaskType(rawTask.task_type, fallbackTaskType);
      const priority = normalizePriority(rawTask.priority, ticket.priority);
      const title = (rawTask.title || ticket.title).trim().slice(0, 500) || ticket.title;
      const description = rawTask.description?.trim() || ticket.description || ticket.title;

      db.prepare(
        `INSERT INTO tasks (
          id, title, description, status, priority, task_type,
          effort, impact, assignee_type, workspace_id, org_ticket_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'inbox', ?, ?, ?, ?, 'ai', ?, ?, ?, ?)`,
      ).run(
        taskId,
        title,
        description,
        priority,
        taskType,
        clampScore(rawTask.effort, 3),
        clampScore(rawTask.impact, 3),
        workspaceId,
        ticketId,
        now,
        now,
      );

      const acceptanceCriteria = Array.isArray(rawTask.acceptance_criteria)
        ? rawTask.acceptance_criteria.map((item) => item.trim()).filter((item) => item.length > 0)
        : [];

      if (acceptanceCriteria.length > 0) {
        for (let i = 0; i < acceptanceCriteria.length; i += 1) {
          db.prepare(
            `INSERT INTO task_acceptance_criteria (id, task_id, description, sort_order, is_met)
             VALUES (?, ?, ?, ?, 0)`,
          ).run(uuidv4(), taskId, acceptanceCriteria[i], i);
        }
      }

      db.prepare(
        `INSERT INTO entity_links (
          id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, link_type, explanation, created_at
        ) VALUES (?, 'org_ticket', ?, 'task', ?, 'delegates_to', ?, ?)`,
      ).run(
        uuidv4(),
        ticketId,
        taskId,
        `Delegated from org ticket: ${ticket.title}`,
        now,
      );

      createTaskActivity({
        taskId,
        activityType: 'updated',
        message: `Delegated from org ticket: ${ticket.title}`,
        metadata: {
          org_ticket_id: ticketId,
          delegation_source: 'org_ticket',
          workflow_step: 'inbox',
          decision_event: true,
        },
      });

      createdTaskIds.push(taskId);
    }
  });

  try {
    tx();
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_DELEGATED') {
      return { success: false, task_ids: [], error: 'Ticket already delegated or in progress', llm_used: false };
    }
    throw error;
  }

  const updatedTicket = db.prepare('SELECT * FROM org_tickets WHERE id = ? LIMIT 1').get(ticketId) as OrgTicketRow;
  broadcast({
    type: 'org_ticket_updated',
    payload: updatedTicket,
  });

  for (const taskId of createdTaskIds) {
    const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ? LIMIT 1').get(taskId) as Task | undefined;
    if (createdTask) {
      broadcast({ type: 'task_created', payload: createdTask });
    }
  }

  return {
    success: true,
    task_ids: createdTaskIds,
    llm_used: llmUsed,
  };
}
