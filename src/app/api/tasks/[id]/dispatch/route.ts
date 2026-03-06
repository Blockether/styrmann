import { NextRequest, NextResponse } from 'next/server';
import { dispatchTaskToAgent } from '@/lib/dispatch';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const result = await dispatchTaskToAgent(id);

    if (!result.success) {
      if (result.warning === 'Other orchestrators available') {
        const count = result.otherOrchestrators?.length || 0;
        const names = result.otherOrchestrators?.map((orchestrator) => orchestrator.name).join(', ') || '';
        return NextResponse.json(
          {
            success: false,
            warning: result.warning,
            message: `There ${count === 1 ? 'is' : 'are'} ${count} other orchestrator${count === 1 ? '' : 's'} available in this workspace: ${names}. Consider assigning this task to them instead.`,
            otherOrchestrators: result.otherOrchestrators || [],
          },
          { status: 409 }
        );
      }

      if (result.error === 'Task not found' || result.error === 'Assigned agent not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      if (result.error === 'Task has no assigned agent') {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      if (result.error === 'Failed to connect to OpenClaw Gateway') {
        return NextResponse.json({ error: result.error }, { status: 503 });
      }

      return NextResponse.json({ error: result.error || 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      task_id: result.taskId,
      agent_id: result.agentId,
      session_id: result.sessionId,
      message: 'Task dispatched to agent',
    });
  } catch (error) {
    console.error('Failed to dispatch task:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
