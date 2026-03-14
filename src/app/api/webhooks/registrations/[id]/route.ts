import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    let event_types: string[] = [];
    try { event_types = JSON.parse((webhook.event_types as string) || '[]'); } catch { /* ignore */ }

    const deliveries = db.prepare(
      'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(id);

    return NextResponse.json({ ...webhook, event_types, recent_deliveries: deliveries });
  } catch (error) {
    console.error('Failed to fetch webhook:', error);
    return NextResponse.json({ error: 'Failed to fetch webhook' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.url !== undefined) {
      try {
        new URL(body.url);
      } catch {
        return NextResponse.json({ error: 'url must be a valid URL' }, { status: 400 });
      }
      updates.push('url = ?');
      values.push(body.url);
    }

    if (body.secret !== undefined) {
      updates.push('secret = ?');
      values.push(body.secret || null);
    }

    if (body.event_types !== undefined) {
      if (!Array.isArray(body.event_types)) {
        return NextResponse.json({ error: 'event_types must be an array' }, { status: 400 });
      }
      updates.push('event_types = ?');
      values.push(JSON.stringify(body.event_types));
    }

    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    return NextResponse.json(webhook);
  } catch (error) {
    console.error('Failed to update webhook:', error);
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);

    broadcast({ type: 'webhook_deleted', payload: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete webhook:', error);
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
