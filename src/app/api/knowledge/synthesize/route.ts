import { NextRequest, NextResponse } from 'next/server';
import { synthesizeKnowledge } from '@/lib/knowledge-synthesis';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id, workspace_id, force_refresh } = body as {
      organization_id?: string;
      workspace_id?: string;
      force_refresh?: boolean;
    };

    if (!organization_id) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    const result = await synthesizeKnowledge(organization_id, {
      workspaceId: workspace_id,
      forceRefresh: force_refresh,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Synthesize endpoint]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
