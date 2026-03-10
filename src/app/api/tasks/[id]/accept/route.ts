import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { queryOne, run } from '@/lib/db';
import { getWorkspaceRepoPath, isGitWorkTree } from '@/lib/git-repo';
import { createTaskActivity } from '@/lib/task-activity';
import { handleStageFailure, drainQueue } from '@/lib/workflow-engine';
import { captureTaskRunResult } from '@/lib/task-run-results';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseBranchFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { branch?: unknown; git_branch?: unknown };
    const candidate = typeof parsed.branch === 'string' ? parsed.branch : (typeof parsed.git_branch === 'string' ? parsed.git_branch : null);
    return candidate && candidate.trim().length > 0 ? candidate.trim() : null;
  } catch {
    return null;
  }
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', timeout: 10000 }).trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const body = await request.json().catch(() => ({})) as {
      action?: 'accept' | 'reject';
      reason?: string;
      branch?: string;
    };

    const action = body.action || 'accept';
    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!['review', 'verification'].includes(task.status)) {
      return NextResponse.json({ error: `Task must be in review/verification to process acceptance. Current status: ${task.status}` }, { status: 400 });
    }

    if (action === 'reject') {
      const reason = (body.reason || '').trim();
      if (!reason) {
        return NextResponse.json({ error: 'reason is required when rejecting' }, { status: 400 });
      }

      const result = await handleStageFailure(taskId, task.status, reason);
      return NextResponse.json({
        success: result.success,
        action: 'reject',
        message: result.success ? 'Task returned to loop start for rework.' : (result.error || 'Failed to loop task back'),
      }, { status: result.success ? 200 : 500 });
    }

    const unmetCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM task_acceptance_criteria WHERE task_id = ? AND is_met = 0',
      [taskId],
    )?.count || 0;
    if (unmetCount > 0) {
      return NextResponse.json({ error: `Acceptance criteria incomplete (${unmetCount} unmet)` }, { status: 409 });
    }

    const workspace = queryOne<{ github_repo?: string | null; workspace_id: string }>(
      `SELECT w.github_repo as github_repo, t.workspace_id as workspace_id
       FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.id = ?`,
      [taskId],
    );
    const repoPath = getWorkspaceRepoPath(workspace?.github_repo || null);
    if (!repoPath || !isGitWorkTree(repoPath)) {
      return NextResponse.json({ error: 'Workspace repo unavailable for merge' }, { status: 400 });
    }

    const latestBranch = queryOne<{ metadata: string | null }>(
      `SELECT metadata
       FROM task_activities
       WHERE task_id = ? AND metadata IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [taskId],
    );

    const branch = (body.branch && body.branch.trim())
      || parseBranchFromMetadata(latestBranch?.metadata)
      || `task/${taskId}`;

    try {
      runGit(repoPath, ['rev-parse', '--verify', branch]);
    } catch {
      return NextResponse.json({ error: `Branch not found: ${branch}` }, { status: 404 });
    }

    const defaultBranchCandidates = ['main', 'master'];
    let defaultBranch = 'main';
    for (const candidate of defaultBranchCandidates) {
      try {
        runGit(repoPath, ['rev-parse', '--verify', candidate]);
        defaultBranch = candidate;
        break;
      } catch {
      }
    }

    runGit(repoPath, ['checkout', defaultBranch]);

    try {
      runGit(repoPath, ['merge', '--no-ff', '--no-edit', branch]);
    } catch (error) {
      try {
        runGit(repoPath, ['merge', '--abort']);
      } catch {
      }

      const reason = `Merge conflict while merging ${branch} into ${defaultBranch}. ${(error as Error).message}`;
      await handleStageFailure(taskId, task.status, reason);

      return NextResponse.json(
        {
          success: false,
          action: 'accept',
          conflict: true,
          message: 'Merge conflict detected. Task looped back for agent conflict resolution.',
          branch,
          base: defaultBranch,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    run(
      'UPDATE tasks SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?',
      ['done', `Accepted by human and merged: ${branch} -> ${defaultBranch}`, now, taskId],
    );

    createTaskActivity({
      taskId,
      activityType: 'status_changed',
      message: `Human acceptance merged ${branch} into ${defaultBranch}`,
      metadata: {
        branch,
        base_branch: defaultBranch,
        action: 'accept_merge',
        workflow_step: task.status,
        decision_event: true,
      },
    });

    try {
      captureTaskRunResult(taskId);
    } catch (error) {
      console.error('[Task Runs] snapshot capture failed on accept merge:', error);
    }

    drainQueue(taskId, task.workspace_id).catch((error) =>
      console.error('[Workflow] drainQueue after accept merge failed:', error),
    );

    const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);

    return NextResponse.json({
      success: true,
      action: 'accept',
      message: `Merged ${branch} into ${defaultBranch}`,
      branch,
      base: defaultBranch,
      task: updatedTask,
    });
  } catch (error) {
    console.error('Failed to process task acceptance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
