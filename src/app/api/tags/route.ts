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

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT id, workspace_id, name, color
      FROM tags
      WHERE workspace_id = ?
      ORDER BY name ASC
    `).all(workspaceId) as {
      id: string;
      workspace_id: string;
      name: string;
      color: string;
    }[];

    return NextResponse.json(rows.map(mapTag));
  } catch (error) {
    console.error('Failed to fetch tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      workspace_id?: unknown;
      name?: unknown;
      color?: unknown;
    };

    if (typeof body.workspace_id !== 'string' || body.workspace_id.trim().length === 0) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const color = typeof body.color === 'string' && body.color.trim().length > 0
      ? body.color.trim()
      : '#6b7280';

    const db = getDb();
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(body.workspace_id.trim()) as { id: string } | undefined;
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const tagId = crypto.randomUUID();

    try {
      db.prepare(`
        INSERT INTO tags (id, workspace_id, name, color)
        VALUES (?, ?, ?, ?)
      `).run(tagId, body.workspace_id.trim(), body.name.trim(), color);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        return NextResponse.json({ error: 'Tag name already exists in this workspace' }, { status: 409 });
      }
      throw error;
    }

    const created = db.prepare(`
      SELECT id, workspace_id, name, color
      FROM tags
      WHERE id = ?
    `).get(tagId) as {
      id: string;
      workspace_id: string;
      name: string;
      color: string;
    };

    return NextResponse.json(mapTag(created), { status: 201 });
  } catch (error) {
    console.error('Failed to create tag:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
