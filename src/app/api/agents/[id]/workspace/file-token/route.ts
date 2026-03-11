/**
 * Workspace File Token API
 * Generates time-limited signed URLs for workspace file access.
 * Tokens are valid for 2 hours and bound to a specific agent, scope, and file path.
 *
 * GET /api/agents/:id/workspace/file-token?scope=workspace&path=pdfs/file.pdf
 *
 * This endpoint is itself protected by normal auth (same-origin / Bearer),
 * so only authenticated users can generate file tokens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { generateFileToken } from '@/lib/file-tokens';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const scope = request.nextUrl.searchParams.get('scope') || 'workspace';
  const path = request.nextUrl.searchParams.get('path');

  if (!path) {
    return NextResponse.json({ error: 'path query parameter is required' }, { status: 400 });
  }

  if (scope !== 'workspace' && scope !== 'agent') {
    return NextResponse.json({ error: 'scope must be workspace or agent' }, { status: 400 });
  }

  // Verify agent exists
  const agent = queryOne<Pick<Agent, 'id'>>('SELECT id FROM agents WHERE id = ?', [id]);
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const { token, expires } = generateFileToken(id, scope, path, 7200); // 2 hours

  const baseUrl = `/api/agents/${id}/workspace/file`;
  const signedUrl = `${baseUrl}?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}&expires=${expires}`;

  return NextResponse.json({ url: signedUrl, token, expires });
}
