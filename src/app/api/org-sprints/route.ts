import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateOrgSprintSchema } from '@/lib/validation';
import type { OrgSprint } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/org-sprints - List sprints with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organization_id = searchParams.get('organization_id');
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = getDb();

    let query = 'SELECT * FROM org_sprints WHERE 1=1';
    const params: unknown[] = [];

    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(organization_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const sprints = db.prepare(query).all(...params) as OrgSprint[];

    return NextResponse.json(sprints);
  } catch (error) {
    console.error('Failed to fetch org sprints:', error);
    return NextResponse.json({ error: 'Failed to fetch org sprints' }, { status: 500 });
  }
}

// POST /api/org-sprints - Create a new org sprint
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateOrgSprintSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      organization_id,
      name,
      description,
      status: sprintStatus,
      start_date,
      end_date,
    } = parsed.data;

    const db = getDb();

    // Verify organization exists
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(organization_id);
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO org_sprints (
        id, organization_id, name, description, status, start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organization_id,
      name,
      description ?? null,
      sprintStatus,
      start_date ?? null,
      end_date ?? null,
    );

    const sprint = db.prepare('SELECT * FROM org_sprints WHERE id = ?').get(id) as OrgSprint;

    broadcast({ type: 'org_sprint_created', payload: sprint });

    return NextResponse.json(sprint, { status: 201 });
  } catch (error) {
    console.error('Failed to create org sprint:', error);
    return NextResponse.json({ error: 'Failed to create org sprint' }, { status: 500 });
  }
}
