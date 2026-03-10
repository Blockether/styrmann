import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string; attachmentId: string }> },
) {
  const { id: workspaceId, entryId, attachmentId } = await params;

  try {
    const attachment = queryOne<{
      id: string;
      knowledge_id: string;
      workspace_id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      content_text: string | null;
      content_base64: string | null;
      source_url: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM knowledge_attachments
       WHERE id = ? AND knowledge_id = ? AND workspace_id = ?
       LIMIT 1`,
      [attachmentId, entryId, workspaceId],
    );

    if (!attachment) {
      return NextResponse.json({ error: 'Knowledge attachment not found' }, { status: 404 });
    }

    return NextResponse.json(attachment);
  } catch (error) {
    console.error('Failed to fetch knowledge attachment:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge attachment' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string; attachmentId: string }> },
) {
  const { id: workspaceId, entryId, attachmentId } = await params;

  try {
    const exists = queryOne<{ id: string }>(
      `SELECT id FROM knowledge_attachments
       WHERE id = ? AND knowledge_id = ? AND workspace_id = ?
       LIMIT 1`,
      [attachmentId, entryId, workspaceId],
    );

    if (!exists) {
      return NextResponse.json({ error: 'Knowledge attachment not found' }, { status: 404 });
    }

    run('DELETE FROM knowledge_attachments WHERE id = ?', [attachmentId]);
    return NextResponse.json({ message: 'Knowledge attachment deleted' });
  } catch (error) {
    console.error('Failed to delete knowledge attachment:', error);
    return NextResponse.json({ error: 'Failed to delete knowledge attachment' }, { status: 500 });
  }
}
