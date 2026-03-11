import { NextRequest, NextResponse } from 'next/server';
import { buildWorkspaceActivitySummary } from '@/lib/task-activity';

export const dynamic = 'force-dynamic';

// GET /api/workspaces/[id]/activity-summary
// Returns presenter summaries across all active tasks in the workspace
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 10;

  try {
    const result = buildWorkspaceActivitySummary(id, limit);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to build workspace activity summary:', error);
    return NextResponse.json({ error: 'Failed to build activity summary' }, { status: 500 });
  }
}
