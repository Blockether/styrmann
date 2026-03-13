import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { queryOne } from '@/lib/db';
import { getWorkspaceRepoPath, isGitWorkTree, getTaskBranchName } from '@/lib/git-repo';
import { createTaskActivity } from '@/lib/task-activity';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function runGit(repoPath: string, args: string[], timeout = 30000): string {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', timeout }).trim();
}

function runGh(repoPath: string, args: string[], timeout = 30000): string {
  return execFileSync('gh', args, {
    cwd: repoPath,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function extractGhOrgRepo(remoteUrl: string): string | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  try {
    const body = await request.json().catch(() => ({})) as {
      branch?: string;
      title?: string;
      body?: string;
    };

    const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const workspace = queryOne<{ github_repo?: string | null; local_path?: string | null; workspace_id: string }>(
      `SELECT w.github_repo as github_repo, w.local_path as local_path, t.workspace_id as workspace_id
       FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
       WHERE t.id = ?`,
      [taskId],
    );

    const repoPath = workspace?.local_path || getWorkspaceRepoPath(workspace?.github_repo || null);
    if (!repoPath || !isGitWorkTree(repoPath)) {
      return NextResponse.json({ error: 'Workspace repo unavailable' }, { status: 400 });
    }

    let upstreamUrl: string;
    try {
      upstreamUrl = runGit(repoPath, ['remote', 'get-url', 'upstream']);
    } catch {
      return NextResponse.json({ error: 'No upstream remote configured. This workspace is not a fork.' }, { status: 400 });
    }

    let originUrl: string;
    try {
      originUrl = runGit(repoPath, ['remote', 'get-url', 'origin']);
    } catch {
      return NextResponse.json({ error: 'No origin remote configured.' }, { status: 400 });
    }

    const upstreamOrgRepo = extractGhOrgRepo(upstreamUrl);
    const originOrgRepo = extractGhOrgRepo(originUrl);
    if (!upstreamOrgRepo || !originOrgRepo) {
      return NextResponse.json({
        error: 'Could not parse GitHub org/repo from remotes.',
        upstream: upstreamUrl,
        origin: originUrl,
      }, { status: 400 });
    }

    const latestBranch = queryOne<{ metadata: string | null }>(
      `SELECT metadata FROM task_activities
       WHERE task_id = ? AND metadata IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [taskId],
    );

    let branch = body.branch?.trim() || null;
    if (!branch && latestBranch?.metadata) {
      try {
        const parsed = JSON.parse(latestBranch.metadata) as { branch?: unknown };
        if (typeof parsed.branch === 'string') branch = parsed.branch.trim();
      } catch {}
    }
    if (!branch) branch = getTaskBranchName(taskId, task.title);

    try {
      runGit(repoPath, ['rev-parse', '--verify', branch]);
    } catch {
      return NextResponse.json({ error: `Branch not found: ${branch}` }, { status: 404 });
    }

    try {
      runGit(repoPath, ['push', 'origin', branch], 30000);
    } catch (pushError) {
      console.error('[Propose Upstream] push branch to origin failed:', pushError);
    }

    const originOwner = originOrgRepo.split('/')[0];
    const headRef = `${originOwner}:${branch}`;

    const prTitle = body.title || task.title;
    const prBody = body.body || [
      `## ${task.title}`,
      '',
      task.description || '',
      '',
      `Branch: \`${branch}\``,
      `Proposed from: [${originOrgRepo}](https://github.com/${originOrgRepo})`,
    ].join('\n');

    let prUrl: string;
    try {
      prUrl = runGh(repoPath, [
        'pr', 'create',
        '--repo', upstreamOrgRepo,
        '--head', headRef,
        '--base', 'main',
        '--title', prTitle,
        '--body', prBody,
      ], 30000);
    } catch (prError) {
      const msg = (prError as Error).message || String(prError);
      if (msg.includes('already exists')) {
        return NextResponse.json({
          error: 'A pull request from this branch already exists.',
          upstream: upstreamOrgRepo,
          head: headRef,
        }, { status: 409 });
      }
      return NextResponse.json({
        error: 'Failed to create upstream PR.',
        detail: msg,
        upstream: upstreamOrgRepo,
        head: headRef,
      }, { status: 500 });
    }

    createTaskActivity({
      taskId,
      activityType: 'status_changed',
      message: `PR proposed upstream: ${prUrl}`,
      metadata: {
        action: 'propose_upstream_pr',
        pr_url: prUrl,
        upstream_repo: upstreamOrgRepo,
        origin_repo: originOrgRepo,
        branch,
        head: headRef,
        decision_event: true,
      },
    });

    return NextResponse.json({
      success: true,
      pr_url: prUrl.trim(),
      upstream_repo: upstreamOrgRepo,
      origin_repo: originOrgRepo,
      branch,
      head: headRef,
    });
  } catch (error) {
    console.error('[Propose Upstream] unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
