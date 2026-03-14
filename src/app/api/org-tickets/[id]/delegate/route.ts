import { NextRequest, NextResponse } from 'next/server';
import { delegateOrgTicket } from '@/lib/delegation';

export const dynamic = 'force-dynamic';

type DelegateRouteBody = {
  workspace_id?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: ticketId } = await params;
    const body = (await request.json().catch(() => ({}))) as DelegateRouteBody;
    const result = await delegateOrgTicket(ticketId, { workspaceId: body.workspace_id });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Delegation failed' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to delegate org ticket:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
