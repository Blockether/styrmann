import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockerId: string }> }
) {
  const { id, blockerId } = await params;

  try {
    const body = await request.json() as { resolved?: unknown };
    if (typeof body.resolved !== 'boolean') {
      return NextResponse.json({ error: 'resolved must be a boolean' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const blocker = db.prepare(
      'SELECT id, task_id FROM task_blockers WHERE id = ? AND task_id = ?'
    ).get(blockerId, id) as { id: string; task_id: string } | undefined;

    if (!blocker) {
      return NextResponse.json({ error: 'Blocker not found' }, { status: 404 });
    }

    db.prepare('UPDATE task_blockers SET resolved = ? WHERE id = ?').run(body.resolved ? 1 : 0, blockerId);

    const updated = db.prepare(`
      SELECT id, task_id, blocked_by_task_id, description, resolved, created_at
      FROM task_blockers
      WHERE id = ?
    `).get(blockerId) as {
      id: string;
      task_id: string;
      blocked_by_task_id: string | null;
      description: string | null;
      resolved: number;
      created_at: string;
    };

    return NextResponse.json(
      {
        ...updated,
        blocked_by_task_id: updated.blocked_by_task_id ?? undefined,
        description: updated.description ?? undefined,
        resolved: updated.resolved === 1,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to update task blocker:', error);
    return NextResponse.json({ error: 'Failed to update task blocker' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; blockerId: string }> }
) {
  const { id, blockerId } = await params;

  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const result = db.prepare('DELETE FROM task_blockers WHERE id = ? AND task_id = ?').run(blockerId, id);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Blocker not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete task blocker:', error);
    return NextResponse.json({ error: 'Failed to delete task blocker' }, { status: 500 });
  }
}
