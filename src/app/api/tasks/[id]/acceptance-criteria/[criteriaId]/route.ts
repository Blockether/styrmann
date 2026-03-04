import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; criteriaId: string }> }
) {
  const { id, criteriaId } = await params;

  try {
    const body = await request.json() as {
      description?: unknown;
      is_met?: unknown;
    };

    const updates: string[] = [];
    const values: Array<string | number> = [];

    if (body.description !== undefined) {
      if (typeof body.description !== 'string' || body.description.trim().length === 0) {
        return NextResponse.json({ error: 'description must be a non-empty string' }, { status: 400 });
      }
      updates.push('description = ?');
      values.push(body.description.trim());
    }

    if (body.is_met !== undefined) {
      if (typeof body.is_met !== 'boolean') {
        return NextResponse.json({ error: 'is_met must be a boolean' }, { status: 400 });
      }
      updates.push('is_met = ?');
      values.push(body.is_met ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const existing = db.prepare(
      'SELECT id FROM task_acceptance_criteria WHERE id = ? AND task_id = ?'
    ).get(criteriaId, id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Acceptance criteria not found' }, { status: 404 });
    }

    values.push(criteriaId, id);
    db.prepare(`
      UPDATE task_acceptance_criteria
      SET ${updates.join(', ')}
      WHERE id = ? AND task_id = ?
    `).run(...values);

    const updated = db.prepare(`
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

    return NextResponse.json(
      {
        ...updated,
        is_met: updated.is_met === 1,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to update task acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to update task acceptance criteria' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; criteriaId: string }> }
) {
  const { id, criteriaId } = await params;

  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const result = db.prepare(
      'DELETE FROM task_acceptance_criteria WHERE id = ? AND task_id = ?'
    ).run(criteriaId, id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Acceptance criteria not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete task acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to delete task acceptance criteria' }, { status: 500 });
  }
}
