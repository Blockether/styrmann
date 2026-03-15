import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface AttachmentRow {
  id: string;
  org_ticket_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  content: Buffer | null;
  description: string | null;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params;

  try {
    const db = getDb();

    const attachment = db.prepare(
      'SELECT * FROM org_ticket_attachments WHERE id = ? AND org_ticket_id = ?'
    ).get(attachmentId, id) as AttachmentRow | undefined;

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (!attachment.content) {
      return NextResponse.json({ error: 'Attachment content is empty' }, { status: 404 });
    }

    const contentType = attachment.mime_type || 'application/octet-stream';
    const fileName = attachment.file_name || 'download';

    const body = new Uint8Array(attachment.content);
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(body.length),
      },
    });
  } catch (error) {
    console.error('Failed to download org ticket attachment:', error);
    return NextResponse.json({ error: 'Failed to download attachment' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params;

  try {
    const db = getDb();

    const attachment = db.prepare(
      'SELECT id FROM org_ticket_attachments WHERE id = ? AND org_ticket_id = ?'
    ).get(attachmentId, id);

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM org_ticket_attachments WHERE id = ?').run(attachmentId);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Failed to delete org ticket attachment:', error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
