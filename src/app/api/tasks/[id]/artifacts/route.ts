import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES: TaskStatus[] = [
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

    const artifacts = db.prepare(
      `SELECT id, task_id, stage_status, artifact_key, artifact_value, created_at, updated_at
       FROM task_artifacts
       WHERE task_id = ?
       ORDER BY updated_at DESC`
    ).all(taskId);
    return NextResponse.json(artifacts);
  } catch (error) {
    console.error('Failed to fetch task artifacts:', error);
    return NextResponse.json({ error: 'Failed to fetch task artifacts' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  try {
    const body = await request.json() as {
      artifact_key?: unknown;
      artifact_value?: unknown;
      stage_status?: unknown;
    };

    const key = typeof body.artifact_key === 'string' ? body.artifact_key.trim() : '';
    if (!key) return NextResponse.json({ error: 'artifact_key is required' }, { status: 400 });

    const value = typeof body.artifact_value === 'string' ? body.artifact_value.trim() : '';
    if (!value) return NextResponse.json({ error: 'artifact_value is required' }, { status: 400 });

    const stageStatus = typeof body.stage_status === 'string' ? body.stage_status.trim() : '';
    if (stageStatus && !ALLOWED_STATUSES.includes(stageStatus as TaskStatus)) {
      return NextResponse.json({ error: 'stage_status is invalid' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId) as { id: string } | undefined;
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO task_artifacts (id, task_id, stage_status, artifact_key, artifact_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id, stage_status, artifact_key) DO UPDATE SET
         artifact_value = excluded.artifact_value,
         updated_at = excluded.updated_at`
    ).run(crypto.randomUUID(), taskId, stageStatus || null, key.toLowerCase(), value, now, now);

    const row = db.prepare(
      `SELECT id, task_id, stage_status, artifact_key, artifact_value, created_at, updated_at
       FROM task_artifacts
       WHERE task_id = ? AND COALESCE(stage_status, '') = ? AND artifact_key = ?`
    ).get(taskId, stageStatus || '', key.toLowerCase());

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('Failed to upsert task artifact:', error);
    return NextResponse.json({ error: 'Failed to upsert task artifact' }, { status: 500 });
  }
}
