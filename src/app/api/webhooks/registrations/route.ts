import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const organizationId = request.nextUrl.searchParams.get('organization_id');

    const webhooks = organizationId
      ? db.prepare('SELECT * FROM webhooks WHERE organization_id = ? ORDER BY created_at DESC').all(organizationId)
      : db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();

    return NextResponse.json(webhooks);
  } catch (error) {
    console.error('Failed to list webhooks:', error);
    return NextResponse.json({ error: 'Failed to list webhooks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { organization_id, url, secret, event_types, is_active } = body as {
      organization_id?: string;
      url?: string;
      secret?: string;
      event_types?: string[];
      is_active?: boolean;
    };

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'url must be a valid URL' }, { status: 400 });
    }

    if (event_types && !Array.isArray(event_types)) {
      return NextResponse.json({ error: 'event_types must be an array' }, { status: 400 });
    }

    const db = getDb();
    const id = uuidv4();

    db.prepare(`
      INSERT INTO webhooks (id, organization_id, url, secret, event_types, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organization_id || null,
      url,
      secret || null,
      JSON.stringify(event_types || []),
      is_active === false ? 0 : 1
    );

    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);

    return NextResponse.json(webhook, { status: 201 });
  } catch (error) {
    console.error('Failed to create webhook:', error);
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
  }
}
