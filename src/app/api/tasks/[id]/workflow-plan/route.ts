import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { ensureTaskWorkflowPlan, generateTaskWorkflowPlan, updateWorkflowStepPrompt } from '@/lib/workflow-planning';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

const REPLAN_ALLOWED_STATUSES = new Set(['inbox', 'planning', 'pending_dispatch']);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  try {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const data = await ensureTaskWorkflowPlan(taskId);
    return NextResponse.json({ task, ...data });
  } catch (error) {
    console.error('Failed to load workflow plan:', error);
    return NextResponse.json({ error: 'Failed to load workflow plan' }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  try {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!REPLAN_ALLOWED_STATUSES.has(task.status)) {
      return NextResponse.json(
        {
          error: `Replanning is locked after execution starts (current status: ${task.status}).`,
          code: 'REPLAN_LOCKED',
        },
        { status: 409 },
      );
    }

    const data = await generateTaskWorkflowPlan(taskId);
    return NextResponse.json({ task, ...data });
  } catch (error) {
    console.error('Failed to regenerate workflow plan:', error);
    return NextResponse.json({ error: 'Failed to regenerate workflow plan' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;

  try {
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!REPLAN_ALLOWED_STATUSES.has(task.status)) {
      return NextResponse.json(
        {
          error: `Workflow edits are locked after execution starts (current status: ${task.status}).`,
          code: 'REPLAN_LOCKED',
        },
        { status: 409 },
      );
    }

    const body = await request.json() as { step_id?: string; prompt?: string };
    if (!body.step_id || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'step_id and prompt are required' }, { status: 400 });
    }

    const data = updateWorkflowStepPrompt(taskId, body.step_id, body.prompt);
    const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]) || task;
    return NextResponse.json({ task: updatedTask, ...data });
  } catch (error) {
    console.error('Failed to update workflow step prompt:', error);
    return NextResponse.json({ error: 'Failed to update workflow step prompt' }, { status: 500 });
  }
}
