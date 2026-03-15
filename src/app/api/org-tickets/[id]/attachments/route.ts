import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { OrgTicket } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const ticket = db.prepare('SELECT id FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!ticket) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const attachments = db.prepare(
      'SELECT id, org_ticket_id, file_name, file_size, mime_type, description, created_at FROM org_ticket_attachments WHERE org_ticket_id = ? ORDER BY created_at DESC'
    ).all(id);

    return NextResponse.json(attachments);
  } catch (error) {
    console.error('Failed to fetch org ticket attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const ticket = db.prepare('SELECT id FROM org_tickets WHERE id = ?').get(id) as OrgTicket | undefined;
    if (!ticket) {
      return NextResponse.json({ error: 'Org ticket not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachmentId = randomUUID();

    db.prepare(
      'INSERT INTO org_ticket_attachments (id, org_ticket_id, file_name, file_size, mime_type, content) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(attachmentId, id, file.name, file.size, file.type || 'application/octet-stream', buffer);

    const attachment = db.prepare(
      'SELECT id, org_ticket_id, file_name, file_size, mime_type, description, created_at FROM org_ticket_attachments WHERE id = ?'
    ).get(attachmentId);

    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    console.error('Failed to upload org ticket attachment:', error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
