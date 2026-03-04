import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskAcceptanceCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

function mapCriteria(row: {
  id: string;
  task_id: string;
  description: string;
  is_met: number;
  sort_order: number;
  created_at: string;
}): TaskAcceptanceCriteria {
  return {
    id: row.id,
    task_id: row.task_id,
    description: row.description,
    is_met: row.is_met === 1,
    sort_order: row.sort_order,
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
      SELECT id, task_id, description, is_met, sort_order, created_at
      FROM task_acceptance_criteria
      WHERE task_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `).all(id) as {
      id: string;
      task_id: string;
      description: string;
      is_met: number;
      sort_order: number;
      created_at: string;
    }[];

    return NextResponse.json(rows.map(mapCriteria));
  } catch (error) {
    console.error('Failed to fetch task acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to fetch task acceptance criteria' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as {
      description?: unknown;
      is_met?: unknown;
      sort_order?: unknown;
    };

    if (typeof body.description !== 'string' || body.description.trim().length === 0) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }

    const isMet = typeof body.is_met === 'boolean' ? body.is_met : false;
    const sortOrder = typeof body.sort_order === 'number' && Number.isInteger(body.sort_order)
      ? body.sort_order
      : 0;

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const criteriaId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_acceptance_criteria (id, task_id, description, is_met, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(criteriaId, id, body.description.trim(), isMet ? 1 : 0, sortOrder, now);

    const created = db.prepare(`
      SELECT id, task_id, description, is_met, sort_order, created_at
      FROM task_acceptance_criteria
      WHERE id = ?
    `).get(criteriaId) as {
      id: string;
      task_id: string;
      description: string;
      is_met: number;
      sort_order: number;
      created_at: string;
    };

    return NextResponse.json(mapCriteria(created), { status: 201 });
  } catch (error) {
    console.error('Failed to create task acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to create task acceptance criteria' }, { status: 500 });
  }
}
