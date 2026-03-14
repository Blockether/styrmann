import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { UpdateOrgTicketAcceptanceCriteriaSchema } from '@/lib/validation';
import type { OrgTicketAcceptanceCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; acId: string }> }
) {
  const { id, acId } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateOrgTicketAcceptanceCriteriaSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE id = ? AND org_ticket_id = ?'
    ).get(acId, id) as OrgTicketAcceptanceCriteria | undefined;

    if (!existing) {
      return NextResponse.json({ error: 'Acceptance criterion not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (parsed.data.description !== undefined) {
      updates.push('description = ?');
      values.push(parsed.data.description);
    }
    if (parsed.data.sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(parsed.data.sort_order);
    }
    if (parsed.data.is_met !== undefined) {
      updates.push('is_met = ?');
      values.push(parsed.data.is_met);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(acId, id);

    db.prepare(
      `UPDATE org_ticket_acceptance_criteria SET ${updates.join(', ')} WHERE id = ? AND org_ticket_id = ?`
    ).run(...values);

    const criterion = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE id = ?'
    ).get(acId) as OrgTicketAcceptanceCriteria;

    return NextResponse.json(criterion);
  } catch (error) {
    console.error('Failed to update acceptance criterion:', error);
    return NextResponse.json({ error: 'Failed to update acceptance criterion' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; acId: string }> }
) {
  const { id, acId } = await params;

  try {
    const db = getDb();

    const existing = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE id = ? AND org_ticket_id = ?'
    ).get(acId, id) as OrgTicketAcceptanceCriteria | undefined;

    if (!existing) {
      return NextResponse.json({ error: 'Acceptance criterion not found' }, { status: 404 });
    }

    db.prepare(
      'DELETE FROM org_ticket_acceptance_criteria WHERE id = ? AND org_ticket_id = ?'
    ).run(acId, id);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Failed to delete acceptance criterion:', error);
    return NextResponse.json({ error: 'Failed to delete acceptance criterion' }, { status: 500 });
  }
}
