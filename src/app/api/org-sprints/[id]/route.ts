import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { UpdateOrgSprintSchema } from '@/lib/validation';
import type { OrgSprint, OrgTicket } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const sprint = db.prepare('SELECT * FROM org_sprints WHERE id = ?').get(id) as OrgSprint | undefined;
    if (!sprint) {
      return NextResponse.json({ error: 'Org sprint not found' }, { status: 404 });
    }

    const tickets = db.prepare('SELECT * FROM org_tickets WHERE org_sprint_id = ?').all(id) as OrgTicket[];
    const parsedTickets = tickets.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') }));

    return NextResponse.json({ ...sprint, tickets: parsedTickets });
  } catch (error) {
    console.error('Failed to fetch org sprint:', error);
    return NextResponse.json({ error: 'Failed to fetch org sprint' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateOrgSprintSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_sprints WHERE id = ?').get(id) as OrgSprint | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org sprint not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (parsed.data.name !== undefined) {
      updates.push('name = ?');
      values.push(parsed.data.name);
    }
    if (parsed.data.description !== undefined) {
      updates.push('description = ?');
      values.push(parsed.data.description);
    }
    if (parsed.data.status !== undefined) {
      updates.push('status = ?');
      values.push(parsed.data.status);
    }
    if (parsed.data.start_date !== undefined) {
      updates.push('start_date = ?');
      values.push(parsed.data.start_date);
    }
    if (parsed.data.end_date !== undefined) {
      updates.push('end_date = ?');
      values.push(parsed.data.end_date);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE org_sprints SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const sprint = db.prepare('SELECT * FROM org_sprints WHERE id = ?').get(id) as OrgSprint;

    broadcast({ type: 'org_sprint_updated', payload: sprint });

    return NextResponse.json(sprint);
  } catch (error) {
    console.error('Failed to update org sprint:', error);
    return NextResponse.json({ error: 'Failed to update org sprint' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_sprints WHERE id = ?').get(id) as OrgSprint | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org sprint not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM org_sprints WHERE id = ?').run(id);

    broadcast({ type: 'org_sprint_deleted', payload: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete org sprint:', error);
    return NextResponse.json({ error: 'Failed to delete org sprint' }, { status: 500 });
  }
}
