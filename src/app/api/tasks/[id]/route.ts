import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getStyrmannUrl } from '@/lib/config';
import { notify } from '@/lib/notify';
import { finalizeOtherActiveSessionsForTask, finalizeSessionById } from '@/lib/session-lifecycle';
import { checkTransitionEligibility, handleStageTransition, getTaskWorkflow, drainQueue } from '@/lib/workflow-engine';
import { captureTaskRunResult } from '@/lib/task-run-results';
import { checkBuilderEvidence } from '@/lib/builder-evidence';
import { UpdateTaskSchema } from '@/lib/validation';
import { generateTaskWorkflowPlan } from '@/lib/workflow-planning';
import { getTaskPipelineDir, getTaskWorktreePath, getWorkspaceRepoPath } from '@/lib/git-repo';
import type { Task, UpdateTaskRequest, Human } from '@/lib/types';

export const dynamic = 'force-dynamic';

type DispatchMetadata = {
  worktree_path?: unknown;
  output_directory?: unknown;
  session_key?: unknown;
  session_id?: unknown;
};

function withinStyrmannRoot(candidate: string, styrmannRoot: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(styrmannRoot);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function parseDispatchMetadata(raw: string | null): DispatchMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DispatchMetadata;
  } catch {
    return null;
  }
}

function tableHasColumn(table: string, column: string): boolean {
  try {
    const rows = queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.some((row) => row.name === column);
  } catch {
    return false;
  }
}

// GET /api/tasks/[id] - Get a single task
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = queryOne<Task>(
      `SELECT t.*,
        aa.name as assigned_agent_name,
        h.name as assigned_human_name,
        h.email as assigned_human_email,
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
       WHERE t.id = ?`,
      [id]
    );

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const typedTask = task as Task & { assigned_agent_name?: string; assigned_human_name?: string; assigned_human_email?: string; unresolved_dependency_count?: number };
    typedTask.assigned_human = task.assigned_human_id
      ? {
          id: task.assigned_human_id,
          name: typedTask.assigned_human_name || '',
          email: typedTask.assigned_human_email || '',
          is_active: 1,
          created_at: task.created_at,
          updated_at: task.updated_at,
        }
      : undefined;
    typedTask.assignee_display_name = task.assignee_type === 'human'
      ? (typedTask.assigned_human_name || typedTask.assigned_human_email || null)
      : (typedTask.assigned_agent_name || null);
    (typedTask as Task & { is_blocked?: boolean; blocked_reason?: string | null }).is_blocked = Number(typedTask.unresolved_dependency_count || 0) > 0;
    (typedTask as Task & { is_blocked?: boolean; blocked_reason?: string | null }).blocked_reason = Number(typedTask.unresolved_dependency_count || 0) > 0
      ? `Blocked by ${typedTask.unresolved_dependency_count} unresolved dependencies`
      : null;

    return NextResponse.json(task);
  } catch (error) {
    console.error('Failed to fetch task:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

// PATCH /api/tasks/[id] - Update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateTaskRequest & { updated_by_agent_id?: string; updated_by_session_id?: string } = await request.json();

    // Validate input with Zod
    const validation = UpdateTaskSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const validatedData = validation.data;
    let nextStatus = validatedData.status;

    const existing = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();
    let shouldRegeneratePlan = false;

    if (validatedData.status === 'done' && validatedData.updated_by_agent_id) {
      return NextResponse.json(
        { error: 'Forbidden: agents cannot mark tasks done. Use human Accept & Merge action.' },
        { status: 403 }
      );
    }

    if (validatedData.status === 'done') {
      return NextResponse.json(
        {
          error: 'Done requires Accept & Merge flow',
          code: 'done_requires_accept_merge',
          action: { method: 'POST', url: `/api/tasks/${id}/accept`, body: { action: 'accept' } },
        },
        { status: 409 },
      );
    }

    if (validatedData.title !== undefined) {
      updates.push('title = ?');
      values.push(validatedData.title);
      shouldRegeneratePlan = true;
    }
    if (validatedData.description !== undefined) {
      updates.push('description = ?');
      values.push(validatedData.description);
      shouldRegeneratePlan = true;
    }
    if (validatedData.priority !== undefined) {
      updates.push('priority = ?');
      values.push(validatedData.priority);
      shouldRegeneratePlan = true;
    }
    if (validatedData.task_type !== undefined) {
      updates.push('task_type = ?');
      values.push(validatedData.task_type);
      shouldRegeneratePlan = true;
    }
    if (validatedData.effort !== undefined) {
      updates.push('effort = ?');
      values.push(validatedData.effort);
      shouldRegeneratePlan = true;
    }
    if (validatedData.impact !== undefined) {
      updates.push('impact = ?');
      values.push(validatedData.impact);
      shouldRegeneratePlan = true;
    }
    if (validatedData.milestone_id !== undefined) {
      updates.push('milestone_id = ?');
      values.push(validatedData.milestone_id);
    }
    if (validatedData.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(validatedData.due_date);
    }

    // Track if we need to dispatch task
    let shouldDispatch = false;
    const effectiveAssigneeType = validatedData.assignee_type !== undefined
      ? validatedData.assignee_type
      : (existing.assignee_type || 'ai');
    const effectiveAssignedHumanId = validatedData.assigned_human_id !== undefined
      ? validatedData.assigned_human_id
      : (existing.assigned_human_id || null);

    const readinessIssues: string[] = [];
    if (effectiveAssigneeType === 'human' && !effectiveAssignedHumanId) readinessIssues.push('No human assigned');

    if (
      effectiveAssigneeType === 'human' &&
      validatedData.assigned_human_id !== undefined &&
      validatedData.assigned_human_id &&
      existing.status === 'inbox'
    ) {
      nextStatus = 'assigned';
    }

    // Handle status change
    if (nextStatus !== undefined && nextStatus !== existing.status) {
      const eligibility = checkTransitionEligibility(id, nextStatus);
      if (!eligibility.ok) {
        if (eligibility.code === 'dependency_blocked') {
          return NextResponse.json(
            {
              error: 'Dependency gate blocked: task has unresolved dependencies or blockers',
              code: eligibility.code,
              from_status: existing.status,
              to_status: nextStatus,
              blocking: {
                dependencies: eligibility.unresolved_dependencies || [],
                blockers: eligibility.unresolved_blockers || [],
              },
            },
            { status: 409 },
          );
        }
        if (eligibility.code === 'stage_gate_blocked') {
          return NextResponse.json(
            {
              error: 'Stage gate blocked: required artifacts are missing',
              code: eligibility.code,
              from_status: existing.status,
              to_status: nextStatus,
              blocking: {
                stage_gate: {
                  target_status: nextStatus,
                  missing_artifacts: eligibility.missing_artifacts || [],
                  required_artifacts: eligibility.required_artifacts || [],
                  missing_acceptance_criteria: eligibility.missing_acceptance_criteria || [],
                },
              },
            },
            { status: 409 },
          );
        }
      }

      const workflow = getTaskWorkflow(id);
      const currentStage = workflow?.stages.find((stage) => stage.status === existing.status)
        || ((existing.status === 'assigned' || existing.status === 'in_progress')
          ? workflow?.stages.find((stage) => Boolean(stage.role))
          : undefined);

      const currentRole = currentStage?.role || undefined;
      const isForwardBuilderMove =
        currentRole === 'builder' &&
        ['testing', 'review', 'verification', 'done'].includes(nextStatus);

      if (isForwardBuilderMove) {
        const evidence = checkBuilderEvidence(id);
        if (!evidence.ok) {
          return NextResponse.json(
            {
              error:
                'Builder gate blocked: task cannot progress without commit or workspace file evidence. Add at least one file deliverable or create a commit first.',
            },
            { status: 409 },
          );
        }
      }

      updates.push('status = ?');
      values.push(nextStatus);

      // Auto-dispatch when moving to assigned (if we have a valid assignee)
      if (nextStatus === 'assigned' && effectiveAssigneeType === 'ai') {
        shouldDispatch = true;
      }

      // Log status change event
      const eventType = nextStatus === 'done' ? 'task_completed' : 'task_status_changed';
      run(
        `INSERT INTO events (id, type, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), eventType, id, `Task "${existing.title}" moved to ${nextStatus}`, now]
      );
    }

    if (validatedData.assignee_type !== undefined && validatedData.assignee_type !== existing.assignee_type) {
      updates.push('assignee_type = ?');
      values.push(validatedData.assignee_type);
      if (validatedData.assignee_type === 'human') {
        updates.push('assigned_agent_id = ?');
        values.push(null);
        shouldDispatch = false;
        nextStatus = nextStatus || 'assigned';
      }
      if (validatedData.assignee_type === 'ai') {
        updates.push('assigned_human_id = ?');
        values.push(null);
        shouldRegeneratePlan = true;
      }
    }

    let assignedHuman: Human | null = null;
    if (validatedData.assigned_human_id !== undefined && validatedData.assigned_human_id !== existing.assigned_human_id) {
      updates.push('assigned_human_id = ?');
      values.push(validatedData.assigned_human_id);
      if (validatedData.assigned_human_id) {
        assignedHuman = queryOne<Human>('SELECT * FROM humans WHERE id = ? AND is_active = 1', [validatedData.assigned_human_id]) || null;
        if (!assignedHuman) {
          return NextResponse.json({ error: 'Selected human assignee not found' }, { status: 404 });
        }
        updates.push('assigned_agent_id = ?');
        values.push(null);
        nextStatus = nextStatus || 'assigned';
        shouldDispatch = false;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Persist readiness warning for assigned tasks if validation fails
    if (nextStatus === 'assigned' && readinessIssues.length > 0) {
      shouldDispatch = false;
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

    if (body.updated_by_session_id && nextStatus && nextStatus !== existing.status) {
      finalizeSessionById(body.updated_by_session_id, 'completed', now);
    }

    if (effectiveAssigneeType === 'ai' && shouldRegeneratePlan) {
      void generateTaskWorkflowPlan(id);
    }

    // Fetch updated task with all joined fields
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
      const typedTask = task as Task & { assigned_human_name?: string; assigned_human_email?: string; assigned_agent_name?: string };
      typedTask.assigned_human = task.assigned_human_id
        ? {
            id: task.assigned_human_id,
            name: typedTask.assigned_human_name || '',
            email: typedTask.assigned_human_email || '',
            is_active: 1,
            created_at: task.created_at,
            updated_at: task.updated_at,
          }
        : undefined;
      typedTask.assignee_display_name = task.assignee_type === 'human'
        ? (typedTask.assigned_human_name || typedTask.assigned_human_email || null)
        : (typedTask.assigned_agent_name || null);
    }

    if (effectiveAssigneeType === 'human' && (validatedData.assigned_human_id !== undefined || validatedData.assignee_type === 'human')) {
      const humanToNotify = assignedHuman || (effectiveAssignedHumanId ? queryOne<Human>('SELECT * FROM humans WHERE id = ? AND is_active = 1', [effectiveAssignedHumanId]) || null : null);
      if (humanToNotify) {
        const workspace = queryOne<{ slug: string | null }>('SELECT slug FROM workspaces WHERE id = ?', [existing.workspace_id]);
        notify({
          event: 'task_assigned',
          task_id: id,
          title: task?.title || existing.title,
          message: `Task assigned to ${humanToNotify.name}`,
          url: `${getStyrmannUrl()}/workspace/${workspace?.slug || existing.workspace_id}`,
          metadata: {
            assignee_name: humanToNotify.name,
            assignee_email: humanToNotify.email,
            workspace_id: existing.workspace_id,
          },
        });
      }
    }

    if (nextStatus && nextStatus !== existing.status) {
      const workspace = queryOne<{ slug: string | null }>('SELECT slug FROM workspaces WHERE id = ?', [existing.workspace_id]);
      notify({
        event: 'task_status_changed',
        task_id: id,
        title: task?.title || existing.title,
        message: `Task status changed from ${existing.status} to ${nextStatus}`,
        url: `${getStyrmannUrl()}/workspace/${workspace?.slug || existing.workspace_id}`,
        metadata: {
          previous_status: existing.status,
          next_status: nextStatus,
          workspace_id: existing.workspace_id,
        },
      });
    }

    // Broadcast task update via SSE
    if (task) {
      broadcast({
        type: 'task_updated',
        payload: task,
      });
    }

    // Trigger workflow-aware dispatch if needed
    if (shouldDispatch && readinessIssues.length === 0 && effectiveAssigneeType === 'ai') {
      await handleStageTransition(id, nextStatus || 'assigned', {
        previousStatus: existing.status,
      });
    }

    // Trigger workflow handoff for forward stage transitions (testing, review, verification)
    // This is separate from the shouldDispatch block above which handles 'assigned' status
    const workflowStages = ['testing', 'review', 'verification'];
    if (
      nextStatus &&
      nextStatus !== existing.status &&
      workflowStages.includes(nextStatus) &&
      !shouldDispatch // Don't double-trigger if already handled above
    ) {
      const stageResult = await handleStageTransition(id, nextStatus, {
        previousStatus: existing.status,
      });

      if (stageResult.handedOff) {
        console.log(`[PATCH] Workflow handoff: ${existing.status} → ${nextStatus} → agent ${stageResult.newAgentName}`);
        // Re-fetch task to include updated agent assignment
        const refreshed = queryOne<Task>(
          `SELECT t.*, aa.name as assigned_agent_name
           FROM tasks t LEFT JOIN agents aa ON t.assigned_agent_id = aa.id WHERE t.id = ?`,
          [id]
        );
        if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });
      } else if (!stageResult.success && stageResult.error) {
        console.warn(`[PATCH] Workflow handoff blocked: ${stageResult.error}`);
        // Broadcast so the UI picks up the dispatch error banner
        const refreshed = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
        if (refreshed) broadcast({ type: 'task_updated', payload: refreshed });
      }
    }

    // Drain the review queue when a task reaches 'done' (frees the verification slot)
    if (nextStatus === 'done' && existing.status !== 'done') {
      finalizeOtherActiveSessionsForTask(id, null, 'completed');
      try {
        captureTaskRunResult(id);
      } catch (err) {
        console.error('[Task Runs] snapshot capture failed:', err);
      }

      drainQueue(id, existing.workspace_id).catch(err =>
        console.error('[Workflow] drainQueue after done failed:', err)
      );
    }

    if (nextStatus === 'done' && existing.milestone_id) {
      const remainingTasks = queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM tasks WHERE milestone_id = ? AND status != ? AND id != ?',
        [existing.milestone_id, 'done', id]
      );

      if (remainingTasks && remainingTasks.count === 0) {
        run('UPDATE milestones SET status = ?, updated_at = ? WHERE id = ?', ['closed', now, existing.milestone_id]);

        const milestone = queryOne<{ name: string }>(
          'SELECT name FROM milestones WHERE id = ?',
          [existing.milestone_id]
        );

        const orchestrator = queryOne<{ id: string }>(
          `SELECT id FROM agents WHERE role = 'orchestrator' ORDER BY created_at ASC LIMIT 1`,
        );

        if (milestone && orchestrator) {
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              'task_completed',
              orchestrator.id,
              id,
              `Milestone "${milestone.name}" completed - all tasks done`,
              now,
            ]
          );
        }
      }
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error('Failed to update task:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - Delete a task
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const dispatchMetadataRows = queryAll<{ metadata: string | null }>(
      'SELECT metadata FROM task_activities WHERE task_id = ? AND activity_type = ? ORDER BY created_at DESC LIMIT 200',
      [id, 'dispatch_invocation'],
    );

    const workspace = queryOne<{ local_path: string | null; github_repo: string | null }>(
      'SELECT local_path, github_repo FROM workspaces WHERE id = ?',
      [existing.workspace_id],
    );

    const repoPath = getWorkspaceRepoPath(workspace?.local_path || workspace?.github_repo || null);
    if (repoPath && existsSync(repoPath)) {
        const styrmannRoot = path.join(repoPath, '.mission-control');
      const candidatePaths = new Set<string>();

      candidatePaths.add(getTaskPipelineDir(repoPath, id));
      candidatePaths.add(getTaskWorktreePath(repoPath, id, existing.title));

      for (const row of dispatchMetadataRows) {
        const metadata = parseDispatchMetadata(row.metadata);
        if (!metadata) continue;
        if (typeof metadata.worktree_path === 'string' && metadata.worktree_path.trim().length > 0) {
          candidatePaths.add(metadata.worktree_path.trim());
        }
        if (typeof metadata.output_directory === 'string' && metadata.output_directory.trim().length > 0) {
          candidatePaths.add(metadata.output_directory.trim());
        }
      }

      for (const rawCandidate of candidatePaths) {
        if (!rawCandidate) continue;
        const resolvedCandidate = path.resolve(rawCandidate);
          if (!withinStyrmannRoot(resolvedCandidate, styrmannRoot)) continue;
        if (!existsSync(resolvedCandidate)) continue;

        const isWorktreePath = resolvedCandidate.includes(`${path.sep}worktrees${path.sep}`);
        if (isWorktreePath) {
          try {
            execFileSync('git', ['worktree', 'remove', '--force', resolvedCandidate], {
              cwd: repoPath,
              encoding: 'utf8',
              timeout: 15000,
            });
          } catch {
          }
        }

        rmSync(resolvedCandidate, { recursive: true, force: true });
      }
    }

    run('DELETE FROM sessions WHERE task_id = ?', [id]);
    run('DELETE FROM task_run_results WHERE task_id = ?', [id]);
    run('DELETE FROM events WHERE task_id = ?', [id]);
    if (tableHasColumn('acp_bindings', 'task_id')) {
      run('UPDATE acp_bindings SET task_id = NULL WHERE task_id = ?', [id]);
    }
    if (tableHasColumn('github_issues', 'task_id')) {
      run('UPDATE github_issues SET task_id = NULL WHERE task_id = ?', [id]);
    }
    if (tableHasColumn('conversations', 'task_id')) {
      run('DELETE FROM conversations WHERE task_id = ?', [id]);
    }

    run('DELETE FROM tasks WHERE id = ?', [id]);

    // Broadcast deletion via SSE
    broadcast({
      type: 'task_deleted',
      payload: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
