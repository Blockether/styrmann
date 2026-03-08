import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { getProjectsPath } from '@/lib/config';

export function getWorkspaceRepoPath(workspaceRepo?: string | null): string | null {
  if (!workspaceRepo) return null;
  return path.join(getProjectsPath(), workspaceRepo);
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
