import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

type TaskRunRow = {
  id: string;
  task_id: string;
  run_number: number;
  status: string;
  summary?: string | null;
  agent_id?: string | null;
  openclaw_session_id?: string | null;
  completed_activity_id?: string | null;
  metadata?: string | null;
  created_at: string;
};

type ArtifactRow = {
  id: string;
  task_run_result_id: string;
  deliverable_id?: string | null;
  title: string;
  path?: string | null;
  normalized_path?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  encoding?: string | null;
  metadata?: string | null;
  created_at: string;
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<unknown> },
) {
  try {
    const params = await context.params as { id: string };
    const { id: taskId } = params;
    const runs = queryAll<TaskRunRow>(
      `SELECT * FROM task_run_results
       WHERE task_id = ?
       ORDER BY run_number DESC, created_at DESC`,
      [taskId],
    );

    const artifacts = queryAll<ArtifactRow>(
      `SELECT * FROM task_run_result_artifacts
       WHERE task_id = ?
       ORDER BY created_at DESC`,
      [taskId],
    );

    return NextResponse.json(
      runs.map((run) => ({
        ...run,
        metadata: run.metadata ? JSON.parse(run.metadata) : null,
        artifacts: artifacts
          .filter((artifact) => artifact.task_run_result_id === run.id)
          .map((artifact) => ({
            ...artifact,
            metadata: artifact.metadata ? JSON.parse(artifact.metadata) : null,
            has_content: artifact.encoding === 'utf-8' || artifact.encoding === 'base64',
          })),
      })),
    );
  } catch (error) {
    console.error('Failed to fetch task run results:', error);
    return NextResponse.json({ error: 'Failed to fetch task run results' }, { status: 500 });
  }
}
