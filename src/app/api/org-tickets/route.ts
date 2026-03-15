import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateOrgTicketSchema } from '@/lib/validation';
import type { OrgTicket } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/org-tickets - List tickets with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organization_id = searchParams.get('organization_id');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = getDb();

    let query = 'SELECT * FROM org_tickets WHERE 1=1';
    const params: unknown[] = [];

    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(organization_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const tickets = db.prepare(query).all(...params) as OrgTicket[];
    const result = tickets.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]') }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch org tickets:', error);
    return NextResponse.json({ error: 'Failed to fetch org tickets' }, { status: 500 });
  }
}

// POST /api/org-tickets - Create a new org ticket
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateOrgTicketSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      organization_id,
      title,
      description,
      priority,
      ticket_type,
      external_ref,
      creator_name,
      assignee_name,
      due_date,
      tags,
    } = parsed.data;

    const db = getDb();

    // Verify organization exists
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(organization_id);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO org_tickets (
        id, organization_id, title, description, status, priority, ticket_type,
        external_ref, creator_name, assignee_name, due_date, tags
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organization_id,
      title,
      description ?? null,
      priority,
      ticket_type,
      external_ref ?? null,
      creator_name ?? null,
      assignee_name ?? null,
      due_date ?? null,
      JSON.stringify(tags),
    );

    const ticket = db.prepare('SELECT * FROM org_tickets WHERE id = ?').get(id) as OrgTicket;
    const result = { ...ticket, tags: JSON.parse(ticket.tags || '[]') };

    broadcast({ type: 'org_ticket_created', payload: result as unknown as OrgTicket });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to create org ticket:', error);
    return NextResponse.json({ error: 'Failed to create org ticket' }, { status: 500 });
  }
}
