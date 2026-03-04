import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskBlocker } from '@/lib/types';

export const dynamic = 'force-dynamic';

type TaskBlockerRow = {
  id: string;
  task_id: string;
  blocked_by_task_id: string | null;
  blocked_by_task_title: string | null;
  description: string | null;
  resolved: number;
  created_at: string;
};

function mapTaskBlocker(row: TaskBlockerRow): TaskBlocker & { blocked_by_task_title: string | null } {
  return {
    id: row.id,
    task_id: row.task_id,
    blocked_by_task_id: row.blocked_by_task_id ?? undefined,
    description: row.description ?? undefined,
    resolved: row.resolved === 1,
    created_at: row.created_at,
    blocked_by_task_title: row.blocked_by_task_title,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const rows = db.prepare(`
      SELECT
        b.id,
        b.task_id,
        b.blocked_by_task_id,
        bt.title AS blocked_by_task_title,
        b.description,
        b.resolved,
        b.created_at
      FROM task_blockers b
      LEFT JOIN tasks bt ON b.blocked_by_task_id = bt.id
      WHERE b.task_id = ?
      ORDER BY b.created_at DESC
    `).all(id) as TaskBlockerRow[];

    return NextResponse.json(rows.map(mapTaskBlocker));
  } catch (error) {
    console.error('Failed to fetch task blockers:', error);
    return NextResponse.json({ error: 'Failed to fetch task blockers' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as {
      blocked_by_task_id?: unknown;
      description?: unknown;
    };

    const blockedByTaskId = typeof body.blocked_by_task_id === 'string' && body.blocked_by_task_id.trim().length > 0
      ? body.blocked_by_task_id.trim()
      : undefined;
    const description = typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : undefined;

    if (!blockedByTaskId && !description) {
      return NextResponse.json(
        { error: 'Either blocked_by_task_id or description is required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (blockedByTaskId) {
      const blockedByTask = db.prepare('SELECT id FROM tasks WHERE id = ?').get(blockedByTaskId) as { id: string } | undefined;
      if (!blockedByTask) {
        return NextResponse.json({ error: 'blocked_by_task_id is invalid' }, { status: 400 });
      }
    }

    const blockerId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_blockers (id, task_id, blocked_by_task_id, description, resolved, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      blockerId,
      id,
      blockedByTaskId ?? null,
      description ?? null,
      now
    );

    const row = db.prepare(`
      SELECT
        b.id,
        b.task_id,
        b.blocked_by_task_id,
        bt.title AS blocked_by_task_title,
        b.description,
        b.resolved,
        b.created_at
      FROM task_blockers b
      LEFT JOIN tasks bt ON b.blocked_by_task_id = bt.id
      WHERE b.id = ?
    `).get(blockerId) as TaskBlockerRow;

    return NextResponse.json(mapTaskBlocker(row), { status: 201 });
  } catch (error) {
    console.error('Failed to create task blocker:', error);
    return NextResponse.json({ error: 'Failed to create task blocker' }, { status: 500 });
  }
}
