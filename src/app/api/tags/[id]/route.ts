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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as {
      name?: unknown;
      color?: unknown;
    };

    const updates: string[] = [];
    const values: string[] = [];

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
      }
      updates.push('name = ?');
      values.push(body.name.trim());
    }

    if (body.color !== undefined) {
      if (typeof body.color !== 'string' || body.color.trim().length === 0) {
        return NextResponse.json({ error: 'color must be a non-empty string' }, { status: 400 });
      }
      updates.push('color = ?');
      values.push(body.color.trim());
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM tags WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    values.push(id);

    try {
      db.prepare(`
        UPDATE tags
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        return NextResponse.json({ error: 'Tag name already exists in this workspace' }, { status: 409 });
      }
      throw error;
    }

    const updated = db.prepare(`
      SELECT id, workspace_id, name, color
      FROM tags
      WHERE id = ?
    `).get(id) as {
      id: string;
      workspace_id: string;
      name: string;
      color: string;
    };

    return NextResponse.json(mapTag(updated), { status: 200 });
  } catch (error) {
    console.error('Failed to update tag:', error);
    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
