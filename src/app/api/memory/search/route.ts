import { NextRequest, NextResponse } from 'next/server';
import { semanticSearchMemory } from '@/lib/memory-search';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get('q') || '').trim();
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') || undefined;
    const agentId = request.nextUrl.searchParams.get('agent_id') || undefined;
    const limit = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get('limit') || 12)));

    if (!query) {
      return NextResponse.json({ error: 'q is required' }, { status: 400 });
    }

    const results = await semanticSearchMemory(query, { workspaceId, agentId, limit });
    return NextResponse.json({ query, workspace_id: workspaceId, agent_id: agentId, results });
  } catch (error) {
    console.error('Failed to run semantic memory search:', error);
    return NextResponse.json({ error: 'Failed to run semantic memory search' }, { status: 500 });
  }
}
