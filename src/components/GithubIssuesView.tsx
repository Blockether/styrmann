'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Github,
  ExternalLink,
  Plus,
  RefreshCw,
  CircleDot,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import type { GitHubIssue, Workspace } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

interface GithubIssuesViewProps {
  workspaceId: string;
  workspace: Workspace;
  onCreateTask: (issue: GitHubIssue) => void;
}

type IssueStateFilter = 'open' | 'closed' | 'all';

export function GithubIssuesView({ workspaceId, workspace, onCreateTask }: GithubIssuesViewProps) {
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>('open');
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/workspaces/${workspaceId}/github/issues?state=${stateFilter}`
      );
      if (res.ok) {
        const data = await res.json();
        setIssues(Array.isArray(data) ? data : []);
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to fetch issues' }));
        setError(errData.error || 'Failed to fetch issues');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch issues');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, stateFilter]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/github/sync`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchIssues();
      } else {
        const errData = await res.json().catch(() => ({ error: 'Sync failed' }));
        setError(errData.error || 'Sync failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const lastSyncedAt = issues.length > 0 ? issues[0].synced_at : null;
  const hasGithubRepo = workspace.github_repo && workspace.github_repo.trim() !== '';

  const parseLabels = (labelsJson: string): { name: string; color: string }[] => {
    try {
      const parsed = JSON.parse(labelsJson);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((l) =>
        typeof l === 'string'
          ? { name: l, color: '' }
          : { name: l?.name ?? '', color: l?.color ?? '' }
      );
    } catch {
      return [];
    }
  };

  const parseAssignees = (assigneesJson: string): { login: string }[] => {
    try {
      const parsed = JSON.parse(assigneesJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // No GitHub repo configured
  if (!hasGithubRepo) {
    return (
      <div
        data-component="src/components/GithubIssuesView"
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">GitHub Issues</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <Github className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No GitHub Repository</h3>
            <p className="text-sm text-mc-text-secondary">
              Configure a GitHub repo in workspace settings to view issues.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-component="src/components/GithubIssuesView"
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Toolbar */}
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">GitHub Issues</span>
          {lastSyncedAt && (
            <span className="text-xs text-mc-text-secondary hidden sm:inline">
              Last synced: {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as IssueStateFilter)}
            className="min-h-9 px-2 py-1 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 min-h-9 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-accent-red/20 flex items-center justify-center">
              <Github className="w-6 h-6 text-mc-accent-red" />
            </div>
            <p className="text-sm text-mc-accent-red">{error}</p>
          </div>
        ) : issues.length === 0 ? (
          <div className="text-center py-12">
            <Github className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Issues Found</h3>
            <p className="text-sm text-mc-text-secondary">
              {stateFilter === 'open'
                ? 'No open issues in this repository.'
                : stateFilter === 'closed'
                  ? 'No closed issues in this repository.'
                  : 'No issues found in this repository.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {issues.map((issue) => {
              const labels = parseLabels(issue.labels);
              const assignees = parseAssignees(issue.assignees);
              const hasTask = !!issue.task_id;

              return (
                <div
                  key={issue.id}
                  className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 hover:border-mc-accent/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className="mt-1 flex-shrink-0">
                      {issue.state === 'open' ? (
                        <CircleDot className="w-4 h-4 text-mc-accent-green" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-mc-accent-purple" />
                      )}
                    </div>

                    {/* Issue content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-mc-text-secondary font-mono flex-shrink-0">
                            #{issue.issue_number}
                          </span>
                          <h4 className="font-medium text-sm truncate">{issue.title}</h4>
                        </div>
                        <a
                          href={issue.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-1 hover:bg-mc-bg-tertiary rounded transition-colors"
                          title="View on GitHub"
                        >
                          <ExternalLink className="w-4 h-4 text-mc-text-secondary hover:text-mc-accent" />
                        </a>
                      </div>

                      {/* Labels */}
                      {labels.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {labels.map((label, idx) => (
                            <span
                              key={idx}
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={label.color ? {
                                backgroundColor: `#${label.color}33`,
                                color: `#${label.color}`,
                                border: `1px solid #${label.color}66`,
                              } : { backgroundColor: 'var(--mc-bg-tertiary)', color: 'var(--mc-text-secondary)' }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          {/* Assignees */}
                          {assignees.length > 0 && (
                            <div className="flex items-center gap-1">
                              {assignees.slice(0, 3).map((assignee, idx) => (
                                <div
                                  key={idx}
                                  className="w-5 h-5 rounded-full bg-mc-accent/20 flex items-center justify-center text-[10px] font-medium text-mc-accent"
                                  title={assignee.login}
                                >
                                  {getInitials(assignee.login)}
                                </div>
                              ))}
                              {assignees.length > 3 && (
                                <span className="text-xs text-mc-text-secondary">
                                  +{assignees.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Action button */}
                        {hasTask ? (
                          <span className="text-xs text-mc-accent-green flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Linked to task
                          </span>
                        ) : (
                          <button
                            onClick={() => onCreateTask(issue)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-mc-accent text-white rounded text-xs font-medium hover:bg-mc-accent/90 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Create Task
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
