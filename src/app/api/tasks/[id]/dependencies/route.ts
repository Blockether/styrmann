import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listTaskDependencies } from '@/lib/task-dependencies';
import type { TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ALLOWED_REQUIRED_STATUSES: TaskStatus[] = [
  'pending_dispatch',
  'planning',
  'inbox',
  'assigned',
  'in_progress',
  'testing',
  'review',
  'verification',
  'done',
];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId) as { id: string } | undefined;
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    return NextResponse.json(listTaskDependencies(taskId));
  } catch (error) {
    console.error('Failed to fetch task dependencies:', error);
    return NextResponse.json({ error: 'Failed to fetch task dependencies' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  try {
    const body = await request.json() as {
      depends_on_task_id?: unknown;
      required_status?: unknown;
    };

    const dependsOnTaskId = typeof body.depends_on_task_id === 'string' ? body.depends_on_task_id.trim() : '';
    if (!dependsOnTaskId) {
      return NextResponse.json({ error: 'depends_on_task_id is required' }, { status: 400 });
    }
    if (dependsOnTaskId === taskId) {
      return NextResponse.json({ error: 'task cannot depend on itself' }, { status: 400 });
    }

    const requiredStatusRaw = typeof body.required_status === 'string' ? body.required_status.trim() : 'done';
    const requiredStatus = (requiredStatusRaw || 'done') as TaskStatus;
    if (!ALLOWED_REQUIRED_STATUSES.includes(requiredStatus)) {
      return NextResponse.json({ error: 'required_status is invalid' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId) as { id: string } | undefined;
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const depends = db.prepare('SELECT id FROM tasks WHERE id = ?').get(dependsOnTaskId) as { id: string } | undefined;
    if (!depends) return NextResponse.json({ error: 'depends_on_task_id is invalid' }, { status: 400 });

    const dependencyId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, required_status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(dependencyId, taskId, dependsOnTaskId, requiredStatus, new Date().toISOString());

    const created = listTaskDependencies(taskId).find((item) => item.id === dependencyId);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Dependency already exists' }, { status: 409 });
    }
    console.error('Failed to create task dependency:', error);
    return NextResponse.json({ error: 'Failed to create task dependency' }, { status: 500 });
  }
}
