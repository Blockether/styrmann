import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { UpdateOrgMilestoneSchema } from '@/lib/validation';
import type { OrgMilestone, OrgTicket } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const milestone = db.prepare('SELECT * FROM org_milestones WHERE id = ?').get(id) as OrgMilestone | undefined;
    if (!milestone) {
      return NextResponse.json({ error: 'Org milestone not found' }, { status: 404 });
    }

    const tickets = db.prepare('SELECT * FROM org_tickets WHERE org_milestone_id = ?').all(id) as OrgTicket[];
    const parsedTickets = tickets.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') }));

    return NextResponse.json({ ...milestone, org_tickets: parsedTickets });
  } catch (error) {
    console.error('Failed to fetch org milestone:', error);
    return NextResponse.json({ error: 'Failed to fetch org milestone' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateOrgMilestoneSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_milestones WHERE id = ?').get(id) as OrgMilestone | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org milestone not found' }, { status: 404 });
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
    if (parsed.data.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(parsed.data.due_date);
    }
    if (parsed.data.status !== undefined) {
      updates.push('status = ?');
      values.push(parsed.data.status);
    }
    if (parsed.data.priority !== undefined) {
      updates.push('priority = ?');
      values.push(parsed.data.priority);
    }
    if (parsed.data.org_sprint_id !== undefined) {
      updates.push('org_sprint_id = ?');
      values.push(parsed.data.org_sprint_id);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE org_milestones SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const milestone = db.prepare('SELECT * FROM org_milestones WHERE id = ?').get(id) as OrgMilestone;

    broadcast({ type: 'org_milestone_updated', payload: milestone });

    return NextResponse.json(milestone);
  } catch (error) {
    console.error('Failed to update org milestone:', error);
    return NextResponse.json({ error: 'Failed to update org milestone' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_milestones WHERE id = ?').get(id) as OrgMilestone | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org milestone not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM org_milestones WHERE id = ?').run(id);

    broadcast({ type: 'org_milestone_deleted', payload: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete org milestone:', error);
    return NextResponse.json({ error: 'Failed to delete org milestone' }, { status: 500 });
  }
}
