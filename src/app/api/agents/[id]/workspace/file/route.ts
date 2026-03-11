/**
 * Workspace File Serve API
 * Serves raw files from agent workspace/config directories with correct MIME types.
 * Used by the workspace browser UI to preview HTML, PDF, and text files.
 *
 * GET /api/agents/:id/workspace/file?scope=workspace&path=pdfs/file.pdf
 */

import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { resolve, extname, sep, basename } from 'path';
import { queryOne } from '@/lib/db';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.log': 'text/plain',
  '.sh': 'text/plain',
  '.py': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.clj': 'text/plain',
  '.edn': 'text/plain',
  '.rs': 'text/plain',
  '.go': 'text/plain',
};

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

type Scope = 'workspace' | 'agent';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const scope = (request.nextUrl.searchParams.get('scope') || 'workspace') as Scope;
    const requestedPath = request.nextUrl.searchParams.get('path');

    if (!requestedPath) {
      return NextResponse.json({ error: 'path query parameter is required' }, { status: 400 });
    }

    if (scope !== 'workspace' && scope !== 'agent') {
      return NextResponse.json({ error: 'scope must be workspace or agent' }, { status: 400 });
    }

    const agent = queryOne<Pick<Agent, 'id' | 'agent_dir' | 'agent_workspace_path'>>(
      'SELECT id, agent_dir, agent_workspace_path FROM agents WHERE id = ?',
      [id],
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const rootPath = scope === 'workspace' ? agent.agent_workspace_path : agent.agent_dir;
    if (!rootPath) {
      return NextResponse.json({ error: `No ${scope} path configured for this agent` }, { status: 404 });
    }

    if (!existsSync(rootPath)) {
      return NextResponse.json({ error: `${scope} path does not exist on disk` }, { status: 404 });
    }

    const rootRealPath = realpathSync(rootPath);
    const targetPath = resolve(rootPath, requestedPath);

    if (!existsSync(targetPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const targetRealPath = realpathSync(targetPath);
    if (!isWithinRoot(rootRealPath, targetRealPath)) {
      console.warn(`[SECURITY] Workspace file path traversal blocked: ${requestedPath} -> ${targetRealPath}`);
      return NextResponse.json({ error: 'Path escapes workspace root' }, { status: 403 });
    }

    const stats = statSync(targetRealPath);
    if (stats.isDirectory()) {
      return NextResponse.json({ error: 'Path is a directory, not a file' }, { status: 400 });
    }

    if (stats.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
        { status: 400 },
      );
    }

    const ext = extname(targetRealPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(targetRealPath);
    const fileName = basename(targetRealPath);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(stats.size),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, no-cache',
    };

    // For HTML files served in iframe, allow same-origin framing
    if (ext === '.html' || ext === '.htm') {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['Content-Security-Policy'] = "frame-ancestors 'self'";
    }

    return new NextResponse(content, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to serve file';
    console.error('[WORKSPACE FILE]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
