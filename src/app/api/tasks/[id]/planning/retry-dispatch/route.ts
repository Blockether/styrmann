import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import { triggerAutoDispatch } from '@/lib/auto-dispatch';
import { createTaskActivity } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';
/**
 * POST /api/tasks/[id]/planning/retry-dispatch
 * 
 * Retries the auto-dispatch for a completed planning task
 * This endpoint allows users to retry failed dispatches from the UI
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    // Get task details
    const task = queryOne<{
      id: string;
      title: string;
      assigned_agent_id?: string;
      workspace_id?: string;
      planning_complete?: number;
      planning_dispatch_error?: string;
      status: string;
    }>('SELECT * FROM tasks WHERE id = ?', [taskId]);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check if planning is complete
    if (!task.planning_complete) {
      return NextResponse.json({ 
        error: 'Cannot retry dispatch: planning is not complete' 
      }, { status: 400 });
    }

    // Check if there's an assigned agent
    if (!task.assigned_agent_id) {
      return NextResponse.json({ 
        error: 'Cannot retry dispatch: no agent assigned' 
      }, { status: 400 });
    }

    // Get agent name for logging
    const agent = queryOne<{ name: string }>('SELECT name FROM agents WHERE id = ?', [task.assigned_agent_id]);
    const latestSession = queryOne<{ openclaw_session_id: string }>(
      `SELECT openclaw_session_id
       FROM openclaw_sessions
       WHERE task_id = ? AND agent_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [task.id, task.assigned_agent_id],
    );

    // Trigger the dispatch
    const result = await triggerAutoDispatch({
      taskId: task.id,
      taskTitle: task.title,
      agentId: task.assigned_agent_id,
      agentName: agent?.name || 'Unknown Agent',
      workspaceId: task.workspace_id
    });

    // Update task state based on dispatch result — preserve planning data either way
    if (result.success) {
      run(`
        UPDATE tasks
        SET planning_dispatch_error = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `, [taskId]);
      createTaskActivity({
        taskId,
        activityType: 'updated',
        agentId: task.assigned_agent_id,
        message: `Planning dispatch retry succeeded for ${agent?.name || 'assigned agent'}.`,
        metadata: {
          workflow_step: 'planning',
          decision_event: true,
          retry_dispatch: true,
          dispatch_retry_result: 'success',
          openclaw_session_id: latestSession?.openclaw_session_id || null,
        },
      });
    } else {
      // Keep planning data intact so user can retry again without re-planning
      run(`
        UPDATE tasks
        SET planning_dispatch_error = ?,
            status_reason = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `, [result.error, 'Dispatch retry failed: ' + result.error, taskId]);
      createTaskActivity({
        taskId,
        activityType: 'updated',
        agentId: task.assigned_agent_id,
        message: `Planning dispatch retry failed for ${agent?.name || 'assigned agent'}: ${result.error}`,
        metadata: {
          workflow_step: 'planning',
          decision_event: true,
          retry_dispatch: true,
          retry_error: result.error,
          dispatch_retry_result: 'failed',
          openclaw_session_id: latestSession?.openclaw_session_id || null,
        },
      });
    }

    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: 'Dispatch retry successful' 
      });
    } else {
      return NextResponse.json({ 
        error: 'Dispatch retry failed', 
        details: result.error 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to retry dispatch:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Keep planning data intact — just record the error
    run(`
      UPDATE tasks
      SET planning_dispatch_error = ?,
          status_reason = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [`Retry error: ${errorMessage}`, `Retry error: ${errorMessage}`, taskId]);
    createTaskActivity({
      taskId,
      activityType: 'updated',
      message: `Planning dispatch retry crashed: ${errorMessage}`,
      metadata: {
        workflow_step: 'planning',
        decision_event: true,
        retry_dispatch: true,
        retry_error: errorMessage,
        dispatch_retry_result: 'error',
        openclaw_session_id: null,
      },
    });

    return NextResponse.json({
      error: 'Failed to retry dispatch',
      details: errorMessage
    }, { status: 500 });
  }
}
