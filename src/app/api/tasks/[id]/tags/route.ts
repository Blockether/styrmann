import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Tag } from '@/lib/types';

export const dynamic = 'force-dynamic';

function isSqliteConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('UNIQUE constraint failed');
}

function mapTag(row: {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
}): Tag {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    color: row.color,
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
      SELECT t.id, t.workspace_id, t.name, t.color
      FROM tags t
      INNER JOIN task_tags tt ON tt.tag_id = t.id
      WHERE tt.task_id = ?
      ORDER BY t.name ASC
    `).all(id) as {
      id: string;
      workspace_id: string;
      name: string;
      color: string;
    }[];

    return NextResponse.json(rows.map(mapTag));
  } catch (error) {
    console.error('Failed to fetch task tags:', error);
    return NextResponse.json({ error: 'Failed to fetch task tags' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as { tag_id?: unknown };
    if (typeof body.tag_id !== 'string' || body.tag_id.trim().length === 0) {
      return NextResponse.json({ error: 'tag_id is required' }, { status: 400 });
    }

    const tagId = body.tag_id.trim();
    const db = getDb();

    const task = db.prepare('SELECT id, workspace_id FROM tasks WHERE id = ?').get(id) as {
      id: string;
      workspace_id: string;
    } | undefined;

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const tag = db.prepare('SELECT id, workspace_id FROM tags WHERE id = ?').get(tagId) as {
      id: string;
      workspace_id: string;
    } | undefined;

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    if (tag.workspace_id !== task.workspace_id) {
      return NextResponse.json({ error: 'Tag does not belong to the task workspace' }, { status: 400 });
    }

    try {
      db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(id, tagId);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        return NextResponse.json({ error: 'Tag is already linked to this task' }, { status: 409 });
      }
      throw error;
    }

    const linked = db.prepare(`
      SELECT id, workspace_id, name, color
      FROM tags
      WHERE id = ?
    `).get(tagId) as {
      id: string;
      workspace_id: string;
      name: string;
      color: string;
    };

    return NextResponse.json(mapTag(linked), { status: 201 });
  } catch (error) {
    console.error('Failed to add tag to task:', error);
    return NextResponse.json({ error: 'Failed to add tag to task' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as { tag_id?: unknown };
    if (typeof body.tag_id !== 'string' || body.tag_id.trim().length === 0) {
      return NextResponse.json({ error: 'tag_id is required' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const result = db.prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?').run(id, body.tag_id.trim());
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Task tag link not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to remove tag from task:', error);
    return NextResponse.json({ error: 'Failed to remove tag from task' }, { status: 500 });
  }
}
