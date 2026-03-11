import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import { getHimalayaStatus, sendHumanAssignmentEmail } from '@/lib/himalaya';
import { CreateTaskSchema } from '@/lib/validation';
import { generateTaskWorkflowPlan } from '@/lib/workflow-planning';
import { inferEffortImpact } from '@/lib/task-scoring';
import type { Task, CreateTaskRequest, Agent, Human } from '@/lib/types';

// GET /api/tasks - List all tasks with optional filters

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const businessId = searchParams.get('business_id');
    const workspaceId = searchParams.get('workspace_id');
    const assignedAgentId = searchParams.get('assigned_agent_id');
    const sprintId = searchParams.get('sprint_id');
    const milestoneId = searchParams.get('milestone_id');
    const taskType = searchParams.get('task_type');
    const backlog = searchParams.get('backlog');

    let sql = `
      SELECT
        t.*,
        aa.name as assigned_agent_name,
        h.name as assigned_human_name,
        h.email as assigned_human_email,
        ca.name as created_by_agent_name,
        m.name as milestone_name,
        (
          SELECT COUNT(*)
          FROM task_dependencies td
          JOIN tasks dep ON dep.id = td.depends_on_task_id
          WHERE td.task_id = t.id
            AND dep.status != td.required_status
        ) as unresolved_dependency_count
      FROM tasks t
      LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
      LEFT JOIN humans h ON t.assigned_human_id = h.id
      LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
      LEFT JOIN milestones m ON t.milestone_id = m.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        sql += ' AND t.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        sql += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }
    if (businessId) {
      sql += ' AND t.business_id = ?';
      params.push(businessId);
    }
    if (workspaceId) {
      sql += ' AND t.workspace_id = ?';
      params.push(workspaceId);
    }
    if (assignedAgentId) {
      sql += ' AND t.assigned_agent_id = ?';
      params.push(assignedAgentId);
    }
    if (sprintId) {
      sql += ' AND t.milestone_id IN (SELECT id FROM milestones WHERE sprint_id = ?)';
      params.push(sprintId);
    }
    if (milestoneId) {
      sql += ' AND t.milestone_id = ?';
      params.push(milestoneId);
    }
    if (taskType) {
      sql += ' AND t.task_type = ?';
      params.push(taskType);
    }
    if (backlog === 'true') {
      sql += ' AND t.milestone_id IS NULL AND t.status != ?';
      params.push('done');
    }

    sql += ' ORDER BY t.created_at DESC';

    const tasks = queryAll<Task & { assigned_agent_name?: string; assigned_human_name?: string; assigned_human_email?: string; created_by_agent_name?: string; milestone_name?: string }>(sql, params);

    const transformedTasks = tasks.map((task) => ({
      ...task,
      assigned_agent: task.assigned_agent_id
        ? {
            id: task.assigned_agent_id,
            name: task.assigned_agent_name,
          }
        : undefined,
      assigned_human: task.assigned_human_id
        ? {
            id: task.assigned_human_id,
            name: task.assigned_human_name || '',
            email: task.assigned_human_email || '',
            is_active: 1,
            created_at: task.created_at,
            updated_at: task.updated_at,
          }
        : undefined,
      assignee_display_name: task.assignee_type === 'human'
        ? (task.assigned_human_name || task.assigned_human_email || null)
        : (task.assigned_agent_name || null),
      milestone: task.milestone_id
        ? { id: task.milestone_id, name: task.milestone_name }
        : undefined,
      is_blocked: Number((task as Task & { unresolved_dependency_count?: number }).unresolved_dependency_count || 0) > 0,
      blocked_reason: Number((task as Task & { unresolved_dependency_count?: number }).unresolved_dependency_count || 0) > 0
        ? `Blocked by ${(task as Task & { unresolved_dependency_count?: number }).unresolved_dependency_count} unresolved dependencies`
        : null,
    }));

    return NextResponse.json(transformedTasks);
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();

    // Validate input with Zod
    const validation = CreateTaskSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const validatedData = validation.data;

    const id = uuidv4();
    const now = new Date().toISOString();

    const workspaceId = validatedData.workspace_id || 'default';
    const assigneeType = validatedData.assignee_type || 'ai';
    const status = validatedData.status || (assigneeType === 'human' ? 'assigned' : 'inbox');
    const inferredScore = inferEffortImpact(validatedData);
    const effort = validatedData.effort ?? inferredScore.effort;
    const impact = validatedData.impact ?? inferredScore.impact;

    const { github_issue_id } = validatedData;
    const assignedAgentId = null;
    const assignedHumanId = assigneeType === 'human' ? (validatedData.assigned_human_id || null) : null;

    if (assigneeType === 'human' && !assignedHumanId) {
      return NextResponse.json({ error: 'Select a human assignee for human tasks' }, { status: 400 });
    }

    let assignedHuman: Human | null = null;
    if (assignedHumanId) {
      assignedHuman = queryOne<Human>('SELECT * FROM humans WHERE id = ? AND is_active = 1', [assignedHumanId]) || null;
      if (!assignedHuman) {
        return NextResponse.json({ error: 'Selected human assignee not found' }, { status: 404 });
      }
    }

    run(
      `INSERT INTO tasks (id, title, description, status, priority, task_type, effort, impact, assignee_type, assigned_agent_id, assigned_human_id, created_by_agent_id, workspace_id, milestone_id, business_id, due_date, workflow_template_id, github_issue_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        validatedData.title,
        validatedData.description || null,
        status,
        validatedData.priority || 'normal',
        validatedData.task_type || 'feature',
        effort,
        impact,
        assigneeType,
        assignedAgentId,
        assignedHumanId,
        validatedData.created_by_agent_id || null,
        workspaceId,
        validatedData.milestone_id || null,
        validatedData.business_id || 'default',
        validatedData.due_date || null,
        null,
        github_issue_id || null,
        now,
        now,
      ]
    );

    if (assigneeType === 'ai') {
      void generateTaskWorkflowPlan(id);
    }

    // Link github issue to this task if provided
    if (github_issue_id) {
      run('UPDATE github_issues SET task_id = ? WHERE id = ?', [id, github_issue_id]);
    }

    // Log event
    let eventMessage = `New task: ${validatedData.title}`;
    if (validatedData.created_by_agent_id) {
      const creator = queryOne<Agent>('SELECT name FROM agents WHERE id = ?', [validatedData.created_by_agent_id]);
      if (creator) {
        eventMessage = `${creator.name} created task: ${validatedData.title}`;
      }
    }

    run(
      `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), 'task_created', body.created_by_agent_id || null, id, eventMessage, now]
    );

    // Fetch created task with all joined fields
    const task = queryOne<Task>(
      `SELECT t.*,
        aa.name as assigned_agent_name,
        h.name as assigned_human_name,
        h.email as assigned_human_email,
        ca.name as created_by_agent_name
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       LEFT JOIN humans h ON t.assigned_human_id = h.id
       LEFT JOIN agents ca ON t.created_by_agent_id = ca.id
       WHERE t.id = ?`,
      [id]
    );

    if (task) {
      (task as Task & { assigned_human_name?: string; assigned_human_email?: string }).assigned_human = task.assigned_human_id
        ? {
            id: task.assigned_human_id,
            name: (task as Task & { assigned_human_name?: string }).assigned_human_name || '',
            email: (task as Task & { assigned_human_email?: string }).assigned_human_email || '',
            is_active: 1,
            created_at: task.created_at,
            updated_at: task.updated_at,
          }
        : undefined;
      (task as Task).assignee_display_name = assigneeType === 'human'
        ? (assignedHuman?.name || assignedHuman?.email || null)
        : null;
    }

    if (assigneeType === 'human' && assignedHuman) {
      const workspace = queryOne<{ name: string; slug: string; coordinator_email?: string | null; himalaya_account?: string | null }>('SELECT name, slug, coordinator_email, himalaya_account FROM workspaces WHERE id = ?', [workspaceId]);
      const himalaya = getHimalayaStatus(workspace?.himalaya_account || null);
      if (!workspace?.coordinator_email) {
        return NextResponse.json({ error: 'Workspace coordinator email is not configured' }, { status: 409 });
      }
      if (!himalaya.installed || !himalaya.configured || !himalaya.configured_account || !himalaya.healthy_account) {
        return NextResponse.json({ error: himalaya.error || 'Himalaya is not configured correctly' }, { status: 409 });
      }

      const sendResult = sendHumanAssignmentEmail({
        account: himalaya.configured_account,
        fromEmail: workspace.coordinator_email,
        toEmail: assignedHuman.email,
        taskTitle: validatedData.title,
        taskDescription: validatedData.description || null,
        workspaceName: workspace.name,
        taskUrl: `${getMissionControlUrl()}/workspace/${workspace.slug}`,
      });
      if (!sendResult.ok) {
        return NextResponse.json({ error: sendResult.error || 'Failed to send assignment email' }, { status: 502 });
      }

      run(
        `INSERT INTO events (id, type, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'task_assigned', id, `"${validatedData.title}" assigned to ${assignedHuman.name} <${assignedHuman.email}>`, now],
      );
    }
    
    // Broadcast task creation via SSE
    if (task) {
      broadcast({
        type: 'task_created',
        payload: task,
      });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error('Failed to create task:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
