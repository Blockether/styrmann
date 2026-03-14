import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CreateOrgTicketAcceptanceCriteriaSchema } from '@/lib/validation';
import type { OrgTicket, OrgTicketAcceptanceCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const criteria = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE org_ticket_id = ? ORDER BY sort_order ASC'
    ).all(id) as OrgTicketAcceptanceCriteria[];

    return NextResponse.json(criteria);
  } catch (error) {
    console.error('Failed to fetch acceptance criteria:', error);
    return NextResponse.json({ error: 'Failed to fetch acceptance criteria' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = CreateOrgTicketAcceptanceCriteriaSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const ticket = db.prepare('SELECT id FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!ticket) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const criterionId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO org_ticket_acceptance_criteria (id, org_ticket_id, description, sort_order, is_met)
       VALUES (?, ?, ?, ?, 0)`
    ).run(criterionId, id, parsed.data.description, parsed.data.sort_order);

    const criterion = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE id = ?'
    ).get(criterionId) as OrgTicketAcceptanceCriteria;

    return NextResponse.json(criterion, { status: 201 });
  } catch (error) {
    console.error('Failed to create acceptance criterion:', error);
    return NextResponse.json({ error: 'Failed to create acceptance criterion' }, { status: 500 });
  }
}
