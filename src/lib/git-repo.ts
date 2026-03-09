import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
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
