import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { UpdateOrgTicketSchema } from '@/lib/validation';
import type { OrgTicket, OrgTicketStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_TRANSITIONS: Record<OrgTicketStatus, OrgTicketStatus[]> = {
  'open': ['triaged', 'closed'],
  'triaged': ['delegated', 'closed'],
  'delegated': ['in_progress', 'closed'],
  'in_progress': ['resolved', 'closed'],
  'resolved': ['closed'],
  'closed': [],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const ticket = db.prepare('SELECT * FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!ticket) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const delegated_tasks = db.prepare('SELECT * FROM tasks WHERE org_ticket_id = ?').all(id);
    const acceptance_criteria = db.prepare(
      'SELECT * FROM org_ticket_acceptance_criteria WHERE org_ticket_id = ? ORDER BY sort_order ASC'
    ).all(id);
    const attachments = db.prepare(
      'SELECT id, org_ticket_id, file_name, file_size, mime_type, description, created_at FROM org_ticket_attachments WHERE org_ticket_id = ? ORDER BY created_at DESC'
    ).all(id);

    const result = {
      ...ticket,
      tags: JSON.parse(ticket.tags || '[]'),
      delegated_tasks,
      acceptance_criteria,
      attachments,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch org ticket:', error);
    return NextResponse.json({ error: 'Failed to fetch org ticket' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateOrgTicketSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const newStatus = parsed.data.status;
    if (newStatus) {
      const currentStatus = existing.status;
      const validNext = VALID_TRANSITIONS[currentStatus] || [];
      if (!validNext.includes(newStatus)) {
        return NextResponse.json({
          error: `Invalid status transition: ${currentStatus} -> ${newStatus}. Valid transitions: ${validNext.join(', ') || 'none (terminal state)'}`,
        }, { status: 400 });
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (parsed.data.title !== undefined) {
      updates.push('title = ?');
      values.push(parsed.data.title);
    }
    if (parsed.data.description !== undefined) {
      updates.push('description = ?');
      values.push(parsed.data.description);
    }
    if (parsed.data.priority !== undefined) {
      updates.push('priority = ?');
      values.push(parsed.data.priority);
    }
    if (parsed.data.ticket_type !== undefined) {
      updates.push('ticket_type = ?');
      values.push(parsed.data.ticket_type);
    }
    if (parsed.data.external_ref !== undefined) {
      updates.push('external_ref = ?');
      values.push(parsed.data.external_ref);
    }
    if (parsed.data.assignee_name !== undefined) {
      updates.push('assignee_name = ?');
      values.push(parsed.data.assignee_name);
    }
    if (parsed.data.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(parsed.data.due_date);
    }
    if (parsed.data.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(parsed.data.tags));
    }
    if (newStatus) {
      updates.push('status = ?');
      values.push(newStatus);
    }
    if (parsed.data.story_points !== undefined) {
      updates.push('story_points = ?');
      values.push(parsed.data.story_points);
    }
    if (parsed.data.org_sprint_id !== undefined) {
      updates.push('org_sprint_id = ?');
      values.push(parsed.data.org_sprint_id);
    }
    if (parsed.data.org_milestone_id !== undefined) {
      updates.push('org_milestone_id = ?');
      values.push(parsed.data.org_milestone_id);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE org_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const ticket = db.prepare('SELECT * FROM org_tickets WHERE id = ?').get(id) as OrgTicket;
    const result = { ...ticket, tags: JSON.parse(ticket.tags || '[]') };

    broadcast({ type: 'org_ticket_updated', payload: result as unknown as OrgTicket });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to update org ticket:', error);
    return NextResponse.json({ error: 'Failed to update org ticket' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const tasks = db.prepare('SELECT id FROM tasks WHERE org_ticket_id = ?').all(id);
    if (tasks.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete ticket with delegated workspace tasks' },
        { status: 409 }
      );
    }

    db.prepare('DELETE FROM org_tickets WHERE id = ?').run(id);

    broadcast({ type: 'org_ticket_deleted', payload: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete org ticket:', error);
    return NextResponse.json({ error: 'Failed to delete org ticket' }, { status: 500 });
  }
}
