import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CreateSprintSchema } from '@/lib/validation';
import type { Sprint } from '@/lib/types';

export const dynamic = 'force-dynamic';

type SprintRow = Sprint & { milestone_name: string | null };

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const milestoneId = request.nextUrl.searchParams.get('milestone_id');
  const status = request.nextUrl.searchParams.get('status');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  try {
    const db = getDb();

    let sql = `
      SELECT
        s.*,
        m.name AS milestone_name
      FROM sprints s
      LEFT JOIN milestones m ON s.milestone_id = m.id
      WHERE s.workspace_id = ?
    `;
    const values: unknown[] = [workspaceId];

    if (milestoneId) {
      sql += ' AND s.milestone_id = ?';
      values.push(milestoneId);
    }

    if (status) {
      sql += ' AND s.status = ?';
      values.push(status);
    }

    sql += ' ORDER BY s.created_at DESC';

    const sprints = db.prepare(sql).all(...values) as SprintRow[];
    return NextResponse.json(sprints);
  } catch (error) {
    console.error('Failed to fetch sprints:', error);
    return NextResponse.json({ error: 'Failed to fetch sprints' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = CreateSprintSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO sprints (id, workspace_id, name, goal, milestone_id, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.workspace_id,
      data.name,
      data.goal || null,
      data.milestone_id || null,
      data.start_date,
      data.end_date,
      'planning',
      now,
      now
    );

    const sprint = db.prepare(`
      SELECT
        s.*,
        m.name AS milestone_name
      FROM sprints s
      LEFT JOIN milestones m ON s.milestone_id = m.id
      WHERE s.id = ?
    `).get(id) as SprintRow | undefined;

    return NextResponse.json(sprint, { status: 201 });
  } catch (error) {
    console.error('Failed to create sprint:', error);
    return NextResponse.json({ error: 'Failed to create sprint' }, { status: 500 });
  }
}
