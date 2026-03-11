import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getMissionControlUrl } from '@/lib/config';
import { getHimalayaStatus, sendHumanAssignmentEmail } from '@/lib/himalaya';
import { handleStageTransition, getTaskWorkflow, drainQueue } from '@/lib/workflow-engine';
import { notifyLearner } from '@/lib/learner';
import { captureTaskRunResult } from '@/lib/task-run-results';
import { checkBuilderEvidence } from '@/lib/builder-evidence';
import { UpdateTaskSchema } from '@/lib/validation';
import { generateTaskWorkflowPlan } from '@/lib/workflow-planning';
import type { Task, UpdateTaskRequest, Agent, Human } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
        h.email as assigned_human_email
       FROM tasks t
       LEFT JOIN agents aa ON t.assigned_agent_id = aa.id
       LEFT JOIN humans h ON t.assigned_human_id = h.id
       WHERE t.id = ?`,
      [id]
    );

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const typedTask = task as Task & { assigned_agent_name?: string; assigned_human_name?: string; assigned_human_email?: string };
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
    const body: UpdateTaskRequest & { updated_by_agent_id?: string } = await request.json();

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

    // If task came from planning mode, require planning to be complete before auto-start
    const planningComplete = Number((existing as any).planning_complete || 0) === 1;
    if (existing.status === 'planning' && !planningComplete) {
      readinessIssues.push('Planning not complete');
    }

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
      const workflow = getTaskWorkflow(id);
      const currentStage = workflow?.stages.find((stage) => stage.status === existing.status)
        || ((existing.status === 'assigned' || existing.status === 'in_progress')
          ? workflow?.stages.find((stage) => stage.role === 'builder')
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
      updates.push('planning_dispatch_error = ?');
      values.push(`Validation: ${readinessIssues.join(', ')}`);
      shouldDispatch = false;
    } else if (nextStatus === 'assigned') {
      updates.push('planning_dispatch_error = NULL');
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

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
      const workspace = queryOne<{ name: string; slug: string; coordinator_email?: string | null; himalaya_account?: string | null }>('SELECT name, slug, coordinator_email, himalaya_account FROM workspaces WHERE id = ?', [existing.workspace_id]);
      if (!workspace?.coordinator_email) {
        return NextResponse.json({ error: 'Workspace coordinator email is not configured' }, { status: 409 });
      }
      const himalaya = getHimalayaStatus(workspace.himalaya_account || null);
      if (!himalaya.installed || !himalaya.configured || !himalaya.configured_account || !himalaya.healthy_account) {
        return NextResponse.json({ error: himalaya.error || 'Himalaya is not configured correctly' }, { status: 409 });
      }
      if (!humanToNotify) {
        return NextResponse.json({ error: 'No active human selected for human assignment' }, { status: 409 });
      }
      const sent = sendHumanAssignmentEmail({
        account: himalaya.configured_account,
        fromEmail: workspace.coordinator_email,
        toEmail: humanToNotify.email,
        taskTitle: task?.title || existing.title,
        taskDescription: task?.description || existing.description || null,
        workspaceName: workspace.name,
        taskUrl: `${getMissionControlUrl()}/workspace/${workspace.slug}`,
      });
      if (!sent.ok) {
        return NextResponse.json({ error: sent.error || 'Failed to send assignment email' }, { status: 502 });
      }
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

    // Notify learner on stage transitions (non-blocking)
    if (nextStatus && nextStatus !== existing.status) {
      const isForwardMove = !['inbox', 'assigned', 'planning', 'pending_dispatch'].includes(nextStatus);
      if (isForwardMove) {
        notifyLearner(id, {
          previousStatus: existing.status,
          newStatus: nextStatus,
          passed: true,
        }).catch(err => console.error('[Learner] notification failed:', err));
      }
    }

    // Drain the review queue when a task reaches 'done' (frees the verification slot)
    if (nextStatus === 'done' && existing.status !== 'done') {
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

        const milestone = queryOne<{ coordinator_agent_id: string | null; name: string }>(
          'SELECT coordinator_agent_id, name FROM milestones WHERE id = ?',
          [existing.milestone_id]
        );

        if (milestone?.coordinator_agent_id) {
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              'task_completed',
              milestone.coordinator_agent_id,
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

    // Delete or nullify related records first (foreign key constraints)
    // Note: task_activities and task_deliverables have ON DELETE CASCADE
    run('DELETE FROM openclaw_sessions WHERE task_id = ?', [id]);
    run('DELETE FROM events WHERE task_id = ?', [id]);
    // Conversations reference tasks - nullify or delete
    run('UPDATE conversations SET task_id = NULL WHERE task_id = ?', [id]);

    // Now delete the task (cascades to task_activities and task_deliverables)
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
