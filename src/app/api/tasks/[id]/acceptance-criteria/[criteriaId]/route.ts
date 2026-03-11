import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { UpdateAcceptanceCriteriaSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; criteriaId: string }> }
) {
  const { id, criteriaId } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateAcceptanceCriteriaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
    }
    const data = parsed.data;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description.trim());
    }

    if (data.is_met !== undefined) {
      updates.push('is_met = ?');
      values.push(data.is_met ? 1 : 0);
    }

    if (data.sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(data.sort_order);
    }

    if (data.parent_criteria_id !== undefined) {
      updates.push('parent_criteria_id = ?');
      values.push(data.parent_criteria_id || null);
    }

    if (data.required_for_status !== undefined) {
      updates.push('required_for_status = ?');
      values.push(data.required_for_status || null);
    }

    if (data.gate_type !== undefined) {
      updates.push('gate_type = ?');
      values.push(data.gate_type);
    }

    if (data.artifact_key !== undefined) {
      updates.push('artifact_key = ?');
      values.push(data.artifact_key ? data.artifact_key.trim().toLowerCase() : null);
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
      SELECT id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at
      FROM task_acceptance_criteria
      WHERE id = ?
    `).get(criteriaId) as {
      id: string;
      task_id: string;
      description: string;
      is_met: number;
      sort_order: number;
      parent_criteria_id: string | null;
      required_for_status: string | null;
      gate_type: string | null;
      artifact_key: string | null;
      created_at: string;
    };

    return NextResponse.json(
      {
        ...updated,
        is_met: updated.is_met === 1,
        gate_type: updated.gate_type || 'manual',
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
