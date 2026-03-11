import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createDefaultSubcriteria } from '@/lib/acceptance-gates';
import { CreateAcceptanceCriteriaSchema } from '@/lib/validation';
import type { TaskAcceptanceCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

function mapCriteria(row: {
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
}): TaskAcceptanceCriteria {
  return {
    id: row.id,
    task_id: row.task_id,
    description: row.description,
    is_met: row.is_met === 1,
    sort_order: row.sort_order,
    parent_criteria_id: row.parent_criteria_id,
    required_for_status: row.required_for_status as TaskAcceptanceCriteria['required_for_status'],
    gate_type: (row.gate_type || 'manual') as TaskAcceptanceCriteria['gate_type'],
    artifact_key: row.artifact_key,
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
      SELECT id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at
      FROM task_acceptance_criteria
      WHERE task_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `).all(id) as {
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
    const body = await request.json();
    const parsed = CreateAcceptanceCriteriaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
    }

    const data = parsed.data;

    const isMet = data.is_met ?? false;
    const sortOrder = data.sort_order ?? 0;
    const requiredForStatus = data.required_for_status ?? 'done';
    const gateType = data.gate_type ?? 'manual';
    const artifactKey = data.artifact_key ? data.artifact_key.trim().toLowerCase() : null;
    const parentCriteriaId = data.parent_criteria_id ?? null;

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const criteriaId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_acceptance_criteria
        (id, task_id, description, is_met, sort_order, parent_criteria_id, required_for_status, gate_type, artifact_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(criteriaId, id, data.description.trim(), isMet ? 1 : 0, sortOrder, parentCriteriaId, requiredForStatus, gateType, artifactKey, now);

    if ((data.create_subcriteria ?? true) && !parentCriteriaId) {
      createDefaultSubcriteria(id, criteriaId, data.description.trim(), requiredForStatus);
    }

    const created = db.prepare(`
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

    return NextResponse.json(mapCriteria(created), { status: 201 });
  } catch (error) {
    console.error('Failed to create task acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to create task acceptance criteria' }, { status: 500 });
  }
}
