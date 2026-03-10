import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string; attachmentId: string }> },
) {
  const { id: workspaceId, entryId, attachmentId } = await params;

  try {
    const attachment = queryOne<{
      id: string;
      file_name: string;
      mime_type: string | null;
      content_text: string | null;
      content_base64: string | null;
      source_url: string | null;
    }>(
      `SELECT id, file_name, mime_type, content_text, content_base64, source_url
       FROM knowledge_attachments
       WHERE id = ? AND knowledge_id = ? AND workspace_id = ?
       LIMIT 1`,
      [attachmentId, entryId, workspaceId],
    );

    if (!attachment) {
      return NextResponse.json({ error: 'Knowledge attachment not found' }, { status: 404 });
    }

    if (attachment.source_url && !attachment.content_text && !attachment.content_base64) {
      return NextResponse.redirect(attachment.source_url, 302);
    }

    const mimeType = attachment.mime_type || 'application/octet-stream';
    if (attachment.content_text !== null) {
      return new NextResponse(attachment.content_text, {
        headers: {
          'Content-Type': `${mimeType}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="${attachment.file_name}"`,
        },
      });
    }

    if (attachment.content_base64) {
      const bytes = Buffer.from(attachment.content_base64, 'base64');
      return new NextResponse(bytes, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${attachment.file_name}"`,
        },
      });
    }

    return NextResponse.json({ error: 'No downloadable content in this attachment' }, { status: 400 });
  } catch (error) {
    console.error('Failed to download knowledge attachment:', error);
    return NextResponse.json({ error: 'Failed to download knowledge attachment' }, { status: 500 });
  }
}
