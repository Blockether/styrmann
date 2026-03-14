import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { UpdateOrganizationSchema } from '@/lib/validation';
import type { Organization } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const org = db.prepare(
      'SELECT * FROM organizations WHERE id = ? OR slug = ?'
    ).get(id, id) as Organization | undefined;

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const workspaces = db.prepare(
      'SELECT * FROM workspaces WHERE organization_id = ? ORDER BY name ASC'
    ).all(org.id);

    return NextResponse.json({ ...org, workspaces });
  } catch (error) {
    console.error('Failed to fetch organization:', error);
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = UpdateOrganizationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Organization | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
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
    if (parsed.data.logo_url !== undefined) {
      updates.push('logo_url = ?');
      values.push(parsed.data.logo_url);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Organization;

    broadcast({ type: 'organization_updated', payload: org });

    return NextResponse.json(org);
  } catch (error) {
    console.error('Failed to update organization:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Organization | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const workspaceCount = db.prepare(
      'SELECT COUNT(*) as count FROM workspaces WHERE organization_id = ?'
    ).get(id) as { count: number };

    if (workspaceCount.count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete organization with workspaces' },
        { status: 409 }
      );
    }

    db.prepare('DELETE FROM organizations WHERE id = ?').run(id);

    broadcast({ type: 'organization_deleted', payload: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete organization:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
