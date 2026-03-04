import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CreateMilestoneSchema } from '@/lib/validation';
import type { Milestone } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  const status = request.nextUrl.searchParams.get('status');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  if (status && status !== 'open' && status !== 'closed') {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }

  try {
    const db = getDb();

    let sql = 'SELECT * FROM milestones WHERE workspace_id = ?';
    const values: unknown[] = [workspaceId];

    if (status) {
      sql += ' AND status = ?';
      values.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const milestones = db.prepare(sql).all(...values) as Milestone[];
    return NextResponse.json(milestones);
  } catch (error) {
    console.error('Failed to fetch milestones:', error);
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = CreateMilestoneSchema.safeParse(body);

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
      INSERT INTO milestones (id, workspace_id, name, description, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.workspace_id,
      data.name,
      data.description || null,
      data.due_date || null,
      'open',
      now,
      now
    );

    const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone | undefined;
    return NextResponse.json(milestone, { status: 201 });
  } catch (error) {
    console.error('Failed to create milestone:', error);
    return NextResponse.json({ error: 'Failed to create milestone' }, { status: 500 });
  }
}
