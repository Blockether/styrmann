import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { getTaskPipelineDir, getWorkspaceRepoPath, isGitWorkTree } from '@/lib/git-repo';
import type { ResourceType, TaskResource } from '@/lib/types';

export const dynamic = 'force-dynamic';

const RESOURCE_TYPES: ResourceType[] = ['link', 'document', 'design', 'api', 'reference'];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename || 'attachment');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'attachment';
}

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
    const contentType = request.headers.get('content-type') || '';
    const db = getDb();
    const task = db.prepare('SELECT id, workspace_id FROM tasks WHERE id = ?').get(id) as { id: string; workspace_id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const resourceTypeRaw = formData.get('resource_type');
      const titleRaw = formData.get('title');

      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 });
      }
      if (file.size <= 0) {
        return NextResponse.json({ error: 'file is empty' }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` }, { status: 400 });
      }

      const resourceType = typeof resourceTypeRaw === 'string' && RESOURCE_TYPES.includes(resourceTypeRaw as ResourceType)
        ? resourceTypeRaw as ResourceType
        : 'document';

      const workspace = db.prepare('SELECT github_repo FROM workspaces WHERE id = ?').get(task.workspace_id) as { github_repo?: string | null } | undefined;
      const repoPath = getWorkspaceRepoPath(workspace?.github_repo || null);
      if (!repoPath || !isGitWorkTree(repoPath)) {
        return NextResponse.json({ error: 'Workspace repo is not available for file ingestion' }, { status: 400 });
      }

      const resourcesDir = path.join(getTaskPipelineDir(repoPath, id), 'resources');
      if (!existsSync(resourcesDir)) {
        mkdirSync(resourcesDir, { recursive: true });
      }

      const safeName = sanitizeFilename(file.name);
      const targetPath = path.join(resourcesDir, `${Date.now()}-${safeName}`);
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      writeFileSync(targetPath, fileBuffer);

      const title = typeof titleRaw === 'string' && titleRaw.trim().length > 0 ? titleRaw.trim() : safeName;
      const previewUrl = `/api/files/preview?path=${encodeURIComponent(targetPath)}`;
      const resourceId = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO task_resources (id, task_id, title, url, resource_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(resourceId, id, title, previewUrl, resourceType, now);

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
    }

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
