import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { ensureTaskWorkflowPlan, generateTaskWorkflowPlan } from '@/lib/workflow-planning';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

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

    const data = await generateTaskWorkflowPlan(taskId);
    return NextResponse.json({ task, ...data });
  } catch (error) {
    console.error('Failed to regenerate workflow plan:', error);
    return NextResponse.json({ error: 'Failed to regenerate workflow plan' }, { status: 500 });
  }
}
