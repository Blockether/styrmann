import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateOrgMilestoneSchema } from '@/lib/validation';
import type { OrgMilestone } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/org-milestones - List milestones with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organization_id = searchParams.get('organization_id');
    const org_sprint_id = searchParams.get('org_sprint_id');
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = getDb();

    let query = 'SELECT * FROM org_milestones WHERE 1=1';
    const params: unknown[] = [];

    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(organization_id);
    }
    if (org_sprint_id) {
      query += ' AND org_sprint_id = ?';
      params.push(org_sprint_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const milestones = db.prepare(query).all(...params) as OrgMilestone[];

    return NextResponse.json(milestones);
  } catch (error) {
    console.error('Failed to fetch org milestones:', error);
    return NextResponse.json({ error: 'Failed to fetch org milestones' }, { status: 500 });
  }
}

// POST /api/org-milestones - Create a new org milestone
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateOrgMilestoneSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      organization_id,
      org_sprint_id,
      name,
      description,
      due_date,
      status: milestoneStatus,
      priority,
    } = parsed.data;

    const db = getDb();

    // Verify organization exists
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(organization_id);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO org_milestones (
        id, organization_id, org_sprint_id, name, description, due_date, status, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organization_id,
      org_sprint_id ?? null,
      name,
      description ?? null,
      due_date ?? null,
      milestoneStatus,
      priority,
    );

    const milestone = db.prepare('SELECT * FROM org_milestones WHERE id = ?').get(id) as OrgMilestone;

    broadcast({ type: 'org_milestone_created', payload: milestone });

    return NextResponse.json(milestone, { status: 201 });
  } catch (error) {
    console.error('Failed to create org milestone:', error);
    return NextResponse.json({ error: 'Failed to create org milestone' }, { status: 500 });
  }
}
