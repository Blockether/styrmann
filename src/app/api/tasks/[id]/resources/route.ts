import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { ResourceType, TaskResource } from '@/lib/types';

export const dynamic = 'force-dynamic';

const RESOURCE_TYPES: ResourceType[] = ['link', 'document', 'design', 'api', 'reference'];

function mapTaskResource(row: {
  id: string;
  task_id: string;
  title: string;
  url: string;
  resource_type: ResourceType;
  created_at: string;
}): TaskResource {
  return {
    id: row.id,
    task_id: row.task_id,
    title: row.title,
    url: row.url,
    resource_type: row.resource_type,
    created_at: row.created_at,
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
      SELECT id, task_id, title, url, resource_type, created_at
      FROM task_resources
      WHERE task_id = ?
      ORDER BY created_at DESC
    `).all(id) as {
      id: string;
      task_id: string;
      title: string;
      url: string;
      resource_type: ResourceType;
      created_at: string;
    }[];

    return NextResponse.json(rows.map(mapTaskResource));
  } catch (error) {
    console.error('Failed to fetch task resources:', error);
    return NextResponse.json({ error: 'Failed to fetch task resources' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as {
      title?: unknown;
      url?: unknown;
      resource_type?: unknown;
    };

    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    if (typeof body.url !== 'string' || body.url.trim().length === 0) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const resourceType = typeof body.resource_type === 'string' ? body.resource_type : 'link';
    if (!RESOURCE_TYPES.includes(resourceType as ResourceType)) {
      return NextResponse.json({ error: 'resource_type is invalid' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const resourceId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_resources (id, task_id, title, url, resource_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      resourceId,
      id,
      body.title.trim(),
      body.url.trim(),
      resourceType,
      now
    );

    const created = db.prepare(`
      SELECT id, task_id, title, url, resource_type, created_at
      FROM task_resources
      WHERE id = ?
    `).get(resourceId) as {
      id: string;
      task_id: string;
      title: string;
      url: string;
      resource_type: ResourceType;
      created_at: string;
    };

    return NextResponse.json(mapTaskResource(created), { status: 201 });
  } catch (error) {
    console.error('Failed to create task resource:', error);
    return NextResponse.json({ error: 'Failed to create task resource' }, { status: 500 });
  }
}
