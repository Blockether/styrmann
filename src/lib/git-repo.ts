import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getProjectsPath } from '@/lib/config';

export function getWorkspaceRepoPath(workspaceRepo?: string | null): string | null {
  if (!workspaceRepo) return null;

  const trimmed = workspaceRepo.trim();

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const org = segments[0];
        const repo = segments[1].replace(/\.git$/i, '');
        const exactPath = path.join(getProjectsPath(), org, repo);
        if (existsSync(exactPath)) return exactPath;
        return path.join(getProjectsPath(), org.toLowerCase(), repo.toLowerCase());
      }
    } catch {
      return path.join(getProjectsPath(), trimmed);
    }
  }

  return path.join(getProjectsPath(), trimmed);
}

export function isGitWorkTree(repoPath: string): boolean {
  if (!existsSync(repoPath)) return false;
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

export function getTaskPipelineDir(repoPath: string, taskId: string): string {
  return path.join(repoPath, '.mission-control', 'tasks', taskId);
}

function runGit(repoPath: string, args: string[], timeout = 10000): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    timeout,
  }).trim();
}

function slugifyTaskTitle(taskTitle?: string | null): string {
  const raw = (taskTitle || 'task').trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return (cleaned || 'task').slice(0, 32);
}

function resolveDefaultBranch(repoPath: string): string {
  try {
    const remoteHead = runGit(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD'], 3000);
    const name = remoteHead.split('/').pop();
    if (name) return name;
  } catch {
  }

  for (const candidate of ['main', 'master']) {
    try {
      runGit(repoPath, ['rev-parse', '--verify', `refs/heads/${candidate}`], 3000);
      return candidate;
    } catch {
    }
  }

  try {
    const current = runGit(repoPath, ['branch', '--show-current'], 3000);
    if (current) return current;
  } catch {
  }

  return 'main';
}

export function getTaskBranchName(taskId: string, taskTitle?: string | null): string {
  const shortId = taskId.slice(0, 8).toLowerCase();
  const slug = slugifyTaskTitle(taskTitle);
  return `task/${slug}-${shortId}`;
}

export function getTaskWorktreePath(repoPath: string, taskId: string, taskTitle?: string | null): string {
  const shortId = taskId.slice(0, 8).toLowerCase();
  const slug = slugifyTaskTitle(taskTitle);
  return path.join(repoPath, '.mission-control', 'worktrees', `${slug}-${shortId}`);
}

export function ensureTaskWorktree(
  repoPath: string,
  taskId: string,
  taskTitle?: string | null,
): { worktreePath: string; branchName: string; defaultBranch: string } {
  const worktreePath = getTaskWorktreePath(repoPath, taskId, taskTitle);
  const branchName = getTaskBranchName(taskId, taskTitle);
  const defaultBranch = resolveDefaultBranch(repoPath);

  const parentDir = path.dirname(worktreePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  if (existsSync(worktreePath) && isGitWorkTree(worktreePath)) {
    try {
      const currentBranch = runGit(worktreePath, ['branch', '--show-current'], 3000);
      if (currentBranch !== branchName) {
        try {
          runGit(worktreePath, ['checkout', branchName], 5000);
        } catch {
          runGit(worktreePath, ['checkout', '-b', branchName, defaultBranch], 5000);
        }
      }
      return { worktreePath, branchName, defaultBranch };
    } catch {
      return { worktreePath, branchName, defaultBranch };
    }
  }

  if (existsSync(worktreePath) && !isGitWorkTree(worktreePath)) {
    throw new Error(`Worktree path exists but is not a git worktree: ${worktreePath}`);
  }

  let branchExists = false;
  try {
    runGit(repoPath, ['show-ref', '--verify', `refs/heads/${branchName}`], 5000);
    branchExists = true;
  } catch {
  }

  if (branchExists) {
    runGit(repoPath, ['worktree', 'add', worktreePath, branchName], 15000);
  } else {
    runGit(repoPath, ['worktree', 'add', '-b', branchName, worktreePath, defaultBranch], 15000);
  }

  return { worktreePath, branchName, defaultBranch };
}
