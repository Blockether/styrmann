import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { queryOne, run } from '@/lib/db';
import { getWorkspaceRepoPath, isGitWorkTree, getTaskBranchName } from '@/lib/git-repo';
import { getMissionControlUrl } from '@/lib/config';
import { notify } from '@/lib/notify';
import { createTaskActivity } from '@/lib/task-activity';
import { checkTransitionEligibility, handleStageFailure, drainQueue } from '@/lib/workflow-engine';
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
      force?: boolean;
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

    const forceAccept = body.force === true;

    const unmetCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM task_acceptance_criteria WHERE task_id = ? AND is_met = 0',
      [taskId],
    )?.count || 0;
    if (unmetCount > 0 && !forceAccept) {
      return NextResponse.json({
        error: `Acceptance criteria incomplete (${unmetCount} unmet)`,
        unmet_count: unmetCount,
        hint: 'Pass { "force": true } to override criteria gate as human reviewer.',
      }, { status: 409 });
    }

    const eligibility = checkTransitionEligibility(taskId, 'done');
    if (!eligibility.ok && !forceAccept) {
      return NextResponse.json(
        {
          error: eligibility.code === 'dependency_blocked'
            ? 'Dependency gate blocked: task has unresolved dependencies or blockers'
            : 'Stage gate blocked: required artifacts are missing',
          code: eligibility.code,
          blocking: {
            dependencies: eligibility.unresolved_dependencies || [],
            blockers: eligibility.unresolved_blockers || [],
            stage_gate: {
              target_status: 'done',
              missing_artifacts: eligibility.missing_artifacts || [],
              required_artifacts: eligibility.required_artifacts || [],
              missing_acceptance_criteria: eligibility.missing_acceptance_criteria || [],
            },
          },
          hint: 'Pass { "force": true } to override gates as human reviewer.',
        },
        { status: 409 },
      );
    }

    const workspace = queryOne<{ github_repo?: string | null; local_path?: string | null; workspace_id: string }>(
      `SELECT w.github_repo as github_repo, w.local_path as local_path, t.workspace_id as workspace_id
       FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.id = ?`,
      [taskId],
    );
    const repoPath = workspace?.local_path || getWorkspaceRepoPath(workspace?.github_repo || null);
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
      || getTaskBranchName(taskId, task.title);

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

    // Push merged default branch to origin
    try {
      runGit(repoPath, ['push', 'origin', defaultBranch]);
    } catch (pushError) {
      console.error('[Accept] Failed to push to origin after merge:', pushError);
    }

    // Push the task branch to origin (needed for upstream PR)
    try {
      runGit(repoPath, ['push', 'origin', branch]);
    } catch {
      // Branch may already be pushed or remote may not exist — not fatal
    }

    // Detect if workspace is a fork (has upstream remote)
    let upstreamRepo: string | null = null;
    let originRepo: string | null = null;
    try {
      upstreamRepo = runGit(repoPath, ['remote', 'get-url', 'upstream']);
    } catch {
      // No upstream remote — not a fork
    }
    try {
      originRepo = runGit(repoPath, ['remote', 'get-url', 'origin']);
    } catch {
      // No origin remote
    }

    const isFork = Boolean(upstreamRepo);

    const now = new Date().toISOString();
    const statusReason = forceAccept
      ? `Force-accepted by human (${unmetCount} criteria overridden) and merged: ${branch} -> ${defaultBranch}`
      : `Accepted by human and merged: ${branch} -> ${defaultBranch}`;
    run(
      'UPDATE tasks SET status = ?, status_reason = ?, planning_dispatch_error = NULL, updated_at = ? WHERE id = ?',
      ['done', statusReason, now, taskId],
    );

    if (unmetCount > 0) {
      run(
        'UPDATE task_acceptance_criteria SET is_met = 1 WHERE task_id = ? AND is_met = 0',
        [taskId],
      );
    }

    createTaskActivity({
      taskId,
      activityType: 'status_changed',
      message: `Human acceptance merged ${branch} into ${defaultBranch}${forceAccept ? ` (force-accepted, ${unmetCount} criteria overridden)` : ''}`,
      metadata: {
        branch,
        base_branch: defaultBranch,
        action: 'accept_merge',
        workflow_step: task.status,
        decision_event: true,
        force_accepted: forceAccept,
        unmet_criteria_overridden: forceAccept ? unmetCount : 0,
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
    const workspaceLink = queryOne<{ slug: string | null }>('SELECT slug FROM workspaces WHERE id = ?', [task.workspace_id]);
    notify({
      event: 'task_accepted',
      task_id: taskId,
      title: updatedTask?.title || task.title,
      message: `Task accepted and merged: ${branch} -> ${defaultBranch}`,
      url: `${getMissionControlUrl()}/workspace/${workspaceLink?.slug || task.workspace_id}`,
      metadata: {
        branch,
        base_branch: defaultBranch,
        force_accepted: forceAccept,
      },
    });

    return NextResponse.json({
      success: true,
      action: 'accept',
      message: `Merged ${branch} into ${defaultBranch}`,
      branch,
      base: defaultBranch,
      task: updatedTask,
      is_fork: isFork,
      upstream_repo: upstreamRepo,
      origin_repo: originRepo,
    });
  } catch (error) {
    console.error('Failed to process task acceptance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
