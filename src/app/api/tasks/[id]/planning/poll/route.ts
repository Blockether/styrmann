import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run, queryAll } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { extractJSON } from '@/lib/planning-utils';
import { generateTaskWorkflowPlan } from '@/lib/workflow-planning';
import { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PLANNING_TIMEOUT_MS = 30_000;
const PLANNING_POLL_INTERVAL_MS = 2_000;

async function handlePlanningCompletion(taskId: string, parsed: { spec?: object; agents?: unknown[]; execution_plan?: object }, messages: unknown[]) {
  const dispatchError: string | null = null;
  run(
    `UPDATE tasks
     SET planning_messages = ?,
         planning_spec = ?,
         planning_agents = ?,
         planning_complete = 1,
         assigned_agent_id = NULL,
         status = 'inbox',
         planning_dispatch_error = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [JSON.stringify(messages), JSON.stringify(parsed.spec || null), JSON.stringify(parsed.agents || []), taskId],
  );

  void generateTaskWorkflowPlan(taskId);

  const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (updatedTask) {
    broadcast({ type: 'task_updated', payload: updatedTask });
  }

  return { firstAgentId: null, parsed, dispatchError };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const task = queryOne<{
      id: string;
      planning_session_key?: string;
      planning_messages?: string;
      planning_complete?: number;
      planning_dispatch_error?: string;
    }>('SELECT * FROM tasks WHERE id = ?', [taskId]);

    if (!task || !task.planning_session_key) {
      return NextResponse.json({ error: 'Planning session not found' }, { status: 404 });
    }

    if (task.planning_complete) {
      return NextResponse.json({ hasUpdates: false, isComplete: true });
    }

    if (task.planning_dispatch_error) {
      return NextResponse.json({
        hasUpdates: true,
        dispatchError: task.planning_dispatch_error,
      });
    }

    const messages = task.planning_messages ? JSON.parse(task.planning_messages) as unknown[] : [];

    return NextResponse.json({ hasUpdates: false, messages });
  } catch (error) {
    console.error('Failed to poll for updates:', error);
    return NextResponse.json({ error: 'Failed to poll for updates' }, { status: 500 });
  }
}
