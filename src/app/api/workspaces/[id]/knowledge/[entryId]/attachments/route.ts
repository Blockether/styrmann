import { NextRequest, NextResponse } from 'next/server';
import { queryAll, queryOne, run } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'attachment.bin';
}

function isLikelyTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType.includes('json')
    || mimeType.includes('xml')
    || mimeType.includes('yaml')
    || mimeType.includes('javascript')
    || mimeType.includes('typescript');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: workspaceId, entryId } = await params;

  try {
    const entry = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ? LIMIT 1',
      [entryId],
    );
    if (!entry || entry.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    const attachments = queryAll<{
      id: string;
      knowledge_id: string;
      workspace_id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_url: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, knowledge_id, workspace_id, file_name, mime_type, size_bytes, source_url, created_at, updated_at
       FROM knowledge_attachments
       WHERE knowledge_id = ?
       ORDER BY created_at DESC`,
      [entryId],
    );

    return NextResponse.json(attachments);
  } catch (error) {
    console.error('Failed to fetch knowledge attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge attachments' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: workspaceId, entryId } = await params;

  try {
    const entry = queryOne<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM knowledge_entries WHERE id = ? LIMIT 1',
      [entryId],
    );
    if (!entry || entry.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';
    let fileName = '';
    let mimeType = '';
    let sourceUrl: string | null = null;
    let contentText: string | null = null;
    let contentBase64: string | null = null;
    let sizeBytes = 0;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const url = formData.get('source_url');

      if (url && typeof url === 'string' && url.trim()) {
        sourceUrl = url.trim();
      }

      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 });
      }

      fileName = sanitizeFileName(file.name || 'attachment.bin');
      mimeType = file.type || 'application/octet-stream';
      sizeBytes = file.size;

      if (sizeBytes > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes` }, { status: 413 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      if (isLikelyTextMime(mimeType)) {
        contentText = buffer.toString('utf-8');
      } else {
        contentBase64 = buffer.toString('base64');
      }
    } else {
      const body = await request.json() as {
        file_name?: string;
        mime_type?: string;
        size_bytes?: number;
        content_text?: string;
        content_base64?: string;
        source_url?: string;
      };

      fileName = sanitizeFileName(String(body.file_name || 'attachment.txt'));
      mimeType = String(body.mime_type || 'text/plain');
      sourceUrl = body.source_url ? String(body.source_url) : null;
      contentText = body.content_text !== undefined ? String(body.content_text) : null;
      contentBase64 = body.content_base64 !== undefined ? String(body.content_base64) : null;

      if (!contentText && !contentBase64 && !sourceUrl) {
        return NextResponse.json({ error: 'content_text, content_base64, or source_url is required' }, { status: 400 });
      }

      if (contentText) {
        sizeBytes = Buffer.byteLength(contentText, 'utf-8');
      } else if (contentBase64) {
        sizeBytes = Buffer.from(contentBase64, 'base64').length;
      } else {
        sizeBytes = Number(body.size_bytes || 0);
      }

      if (sizeBytes > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes` }, { status: 413 });
      }
    }

    const attachmentId = crypto.randomUUID();
    run(
      `INSERT INTO knowledge_attachments
       (id, knowledge_id, workspace_id, file_name, mime_type, size_bytes, content_text, content_base64, source_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [attachmentId, entryId, workspaceId, fileName, mimeType || null, sizeBytes || null, contentText, contentBase64, sourceUrl],
    );

    const attachment = queryOne<{
      id: string;
      knowledge_id: string;
      workspace_id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_url: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM knowledge_attachments WHERE id = ? LIMIT 1', [attachmentId]);

    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    console.error('Failed to create knowledge attachment:', error);
    return NextResponse.json({ error: 'Failed to create knowledge attachment' }, { status: 500 });
  }
}
