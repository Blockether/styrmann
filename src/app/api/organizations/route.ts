import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateOrganizationSchema } from '@/lib/validation';
import type { Organization } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const orgs = db.prepare(`
      SELECT o.*, COUNT(w.id) as workspace_count
      FROM organizations o
      LEFT JOIN workspaces w ON w.organization_id = o.id
      GROUP BY o.id
      ORDER BY o.name ASC
    `).all();

    return NextResponse.json(orgs);
  } catch (error) {
    console.error('Failed to fetch organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateOrganizationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, slug, description, logo_url } = parsed.data;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
    if (existing) {
      return NextResponse.json({ error: 'An organization with this slug already exists' }, { status: 400 });
    }

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO organizations (id, name, slug, description, logo_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, slug, description ?? null, logo_url ?? null);

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Organization;

    broadcast({ type: 'organization_created', payload: org });

    return NextResponse.json(org, { status: 201 });
  } catch (error) {
    console.error('Failed to create organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
