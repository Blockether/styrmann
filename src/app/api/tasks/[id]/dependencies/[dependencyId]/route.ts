import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dependencyId: string }> },
) {
  const { id: taskId, dependencyId } = await params;
  try {
    const body = await request.json() as { required_status?: unknown };
    const requiredStatusRaw = typeof body.required_status === 'string' ? body.required_status.trim() : '';
    if (!requiredStatusRaw) {
      return NextResponse.json({ error: 'required_status is required' }, { status: 400 });
    }
    const requiredStatus = requiredStatusRaw as TaskStatus;
    if (!ALLOWED_REQUIRED_STATUSES.includes(requiredStatus)) {
      return NextResponse.json({ error: 'required_status is invalid' }, { status: 400 });
    }

    const db = getDb();
    const result = db.prepare(
      'UPDATE task_dependencies SET required_status = ? WHERE id = ? AND task_id = ?'
    ).run(requiredStatus, dependencyId, taskId);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 });
    }

    const updated = db.prepare(
      `SELECT id, task_id, depends_on_task_id, required_status, created_at
       FROM task_dependencies WHERE id = ?`
    ).get(dependencyId);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update task dependency:', error);
    return NextResponse.json({ error: 'Failed to update task dependency' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; dependencyId: string }> },
) {
  const { id: taskId, dependencyId } = await params;
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM task_dependencies WHERE id = ? AND task_id = ?').run(dependencyId, taskId);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete task dependency:', error);
    return NextResponse.json({ error: 'Failed to delete task dependency' }, { status: 500 });
  }
}
