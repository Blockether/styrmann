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

    if (attachment.content_text !== null) {
      const safeText = attachment.content_text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${attachment.file_name}</title><style>body{font-family:Atkinson Hyperlegible,system-ui,sans-serif;background:#f9f7f1;color:#27231a;margin:0;padding:16px}pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e2dccf;border-radius:8px;padding:12px}</style></head><body><h1>${attachment.file_name}</h1><pre>${safeText}</pre></body></html>`;
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    if (attachment.content_base64) {
      const mimeType = attachment.mime_type || 'application/octet-stream';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${attachment.file_name}</title><style>body{font-family:Atkinson Hyperlegible,system-ui,sans-serif;background:#f9f7f1;color:#27231a;margin:0;padding:16px}a{color:#9b7a2b}</style></head><body><h1>${attachment.file_name}</h1><p>Binary attachment (${mimeType}). Use download to get the raw file.</p></body></html>`;
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    return NextResponse.json({ error: 'No previewable content in this attachment' }, { status: 400 });
  } catch (error) {
    console.error('Failed to preview knowledge attachment:', error);
    return NextResponse.json({ error: 'Failed to preview knowledge attachment' }, { status: 500 });
  }
}
