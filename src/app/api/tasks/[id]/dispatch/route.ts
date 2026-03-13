import { NextRequest, NextResponse } from 'next/server';
import { dispatchTaskToAgent } from '@/lib/dispatch';
import { checkTransitionEligibility } from '@/lib/workflow-engine';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const eligibility = checkTransitionEligibility(id, 'in_progress');
    if (!eligibility.ok) {
      return NextResponse.json(
        {
          error: eligibility.code === 'dependency_blocked'
            ? 'Dependency gate blocked: task has unresolved dependencies or blockers'
            : 'Stage gate blocked: required artifacts are missing',
          code: eligibility.code,
          from_status: 'assigned',
          to_status: 'in_progress',
          blocking: {
            dependencies: eligibility.unresolved_dependencies || [],
            blockers: eligibility.unresolved_blockers || [],
            stage_gate: {
              target_status: 'in_progress',
              missing_artifacts: eligibility.missing_artifacts || [],
              required_artifacts: eligibility.required_artifacts || [],
              missing_acceptance_criteria: eligibility.missing_acceptance_criteria || [],
            },
          },
        },
        { status: 409 },
      );
    }

    const result = await dispatchTaskToAgent(id);

    if (!result.success) {
      if (result.error === 'Task not found' || result.error === 'Assigned agent not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      if (result.error === 'Task has no assigned agent') {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      if (result.error?.startsWith('Task dependencies unresolved:')) {
        return NextResponse.json(
          { error: result.error, code: 'dependency_blocked' },
          { status: 409 },
        );
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
