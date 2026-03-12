/**
 * DeliverablesList Component
 * Displays deliverables (files, URLs, artifacts) for a task
 */

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Link as LinkIcon, Package, ExternalLink, Eye, Download, X } from 'lucide-react';
import { debug } from '@/lib/debug';
import { summarizeTaskActivity } from '@/lib/activity-presentation';
import type { Task, TaskActivity, TaskDeliverable } from '@/lib/types';

interface DeliverablesListProps {
  taskId: string;
}

interface TaskChangesPayload {
  workspace: {
    id: string;
    name: string | null;
    slug: string | null;
    organization: string | null;
    repo: string | null;
    repo_path: string | null;
    worktree_name?: string | null;
    worktree_branch?: string | null;
  };
  summary: {
    sessions_count: number;
    interruptions_count?: number;
    stales_count?: number;
    finished_count?: number;
    unfinished_count?: number;
    deliverables_count: number;
    changed_files_count: number;
    commits_count: number;
  };
  changed_files: string[];
  commits: Array<{
    hash: string;
    subject: string;
    author: string;
    date: string;
  }>;
}

interface ActivitiesResponse {
  raw_activities: TaskActivity[];
}

// File extensions that can be previewed in the browser
const PREVIEWABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.md', '.markdown', '.txt', '.csv', '.log', '.json', '.xml',
  '.yaml', '.yml', '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.py', '.rb',
  '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh', '.bash', '.toml', '.ini',
  '.sql', '.clj', '.cljs', '.cljc', '.edn', '.ex', '.exs', '.lua', '.swift',
]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
}

function isPreviewable(filePath: string | undefined): boolean {
  if (!filePath) return false;
  return PREVIEWABLE_EXTENSIONS.has(getExtension(filePath));
}

function toTitleCaseLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function DeliverablesList({ taskId }: DeliverablesListProps) {
  const [deliverables, setDeliverables] = useState<TaskDeliverable[]>([]);
  const [changes, setChanges] = useState<TaskChangesPayload | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [rawActivities, setRawActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  const loadDeliverables = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/deliverables`);
      if (res.ok) {
        const data = await res.json();
        setDeliverables(data);
      }

      const changesRes = await fetch(`/api/tasks/${taskId}/changes`);
      if (changesRes.ok) {
        const changesData = await changesRes.json();
        setChanges(changesData);
      }

      const [taskRes, activitiesRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch(`/api/tasks/${taskId}/activities?limit=400`),
      ]);

      if (taskRes.ok) {
        const taskData = await taskRes.json() as Task;
        setTask(taskData);
      }

      if (activitiesRes.ok) {
        const activityData = await activitiesRes.json() as ActivitiesResponse;
        setRawActivities(Array.isArray(activityData.raw_activities) ? activityData.raw_activities : []);
      }
    } catch (error) {
      console.error('Failed to load deliverables:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadDeliverables();
  }, [loadDeliverables]);

  useEffect(() => {
    const reload = () => {
      void loadDeliverables();
    };
    window.addEventListener('mc:deliverable-added', reload);
    window.addEventListener('mc:deliverable-deleted', reload);
    window.addEventListener('mc:activity-logged', reload);
    window.addEventListener('mc:task-updated', reload);
    return () => {
      window.removeEventListener('mc:deliverable-added', reload);
      window.removeEventListener('mc:deliverable-deleted', reload);
      window.removeEventListener('mc:activity-logged', reload);
      window.removeEventListener('mc:task-updated', reload);
    };
  }, [loadDeliverables]);

  const getDeliverableIcon = (type: string) => {
    switch (type) {
      case 'file':
        return <FileText className="w-5 h-5" />;
      case 'url':
        return <LinkIcon className="w-5 h-5" />;
      case 'artifact':
        return <Package className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const handleOpen = async (deliverable: TaskDeliverable) => {
    // URLs open directly in new tab
    if (deliverable.deliverable_type === 'url' && deliverable.path) {
      window.open(deliverable.path, '_blank');
      return;
    }

    // For files: prefer preview (works on headless servers) over reveal (needs GUI)
    if (deliverable.path && isPreviewable(deliverable.path)) {
      handlePreview(deliverable);
      return;
    }

    // Non-previewable files: try reveal, fall back to download
    if (deliverable.path) {
      try {
        debug.file('Opening file in Finder', { path: deliverable.path });
        const res = await fetch('/api/files/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: deliverable.path }),
        });

        if (res.ok) {
          debug.file('Opened in Finder successfully');
          return;
        }

        const error = await res.json();
        debug.file('Failed to open', error);

        if (res.status === 404) {
          alert(`File not found:\n${deliverable.path}\n\nThe file may have been moved or deleted.`);
        } else if (res.status === 403) {
          alert(`Cannot open this location:\n${deliverable.path}\n\nPath is outside allowed directories.`);
        } else {
          // Headless server — reveal failed, try download
          handleDownload(deliverable);
        }
      } catch (error) {
        console.error('Failed to open file:', error);
        handleDownload(deliverable);
      }
    }
  };

  const handlePreview = async (deliverable: TaskDeliverable) => {
    if (!deliverable.path) return;

    debug.file('Opening preview', { path: deliverable.path });
    setPreviewTitle(deliverable.title);
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    setPreviewUrl(`/api/files/preview?path=${encodeURIComponent(deliverable.path)}&returnUrl=${returnUrl}`);
    setPreviewOpen(true);
  };

  const handleDownload = (deliverable: TaskDeliverable) => {
    if (deliverable.path) {
      debug.file('Downloading file', { path: deliverable.path });
      window.open(`/api/files/download?path=${encodeURIComponent(deliverable.path)}&raw=true`, '_blank');
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const buildPhaseSummaries = useCallback((activitiesInput: TaskActivity[], activeStatus?: string) => {
    const grouped = new Map<string, TaskActivity[]>();
    for (const activity of activitiesInput) {
      const step = typeof activity.workflow_step === 'string' && activity.workflow_step.trim().length > 0
        ? activity.workflow_step.trim()
        : 'general';
      if (!grouped.has(step)) grouped.set(step, []);
      grouped.get(step)?.push(activity);
    }

    const phaseOrder = activeStatus
      ? [activeStatus, ...Array.from(grouped.keys()).filter((step) => step !== activeStatus)]
      : Array.from(grouped.keys());

    return phaseOrder
      .filter((step) => grouped.has(step))
      .map((step) => {
        const activities = (grouped.get(step) || []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const iterations = activities.reduce((count, activity) => {
          const message = typeof activity.message === 'string' ? activity.message : '';
          const isIteration = activity.activity_type === 'dispatch_invocation'
            || (activity.activity_type === 'status_changed' && message.startsWith('Stage handoff:'))
            || (activity.activity_type === 'status_changed' && message.startsWith('[Auto-Recovery]'));
          return isIteration ? count + 1 : count;
        }, 0);

        const highlights: string[] = [];
        for (const activity of activities) {
          const line = summarizeTaskActivity(activity).trim();
          if (!line || highlights.includes(line)) continue;
          highlights.push(line);
          if (highlights.length >= 4) break;
        }

        return {
          step,
          activitiesCount: activities.length,
          iterations,
          highlights,
          latestAt: activities[activities.length - 1]?.created_at || null,
        };
      });
  }, []);

  const lastResumeAt = useMemo(() => {
    const sorted = rawActivities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const lastResume = sorted.find((activity) => {
      if (typeof activity.message !== 'string') return false;
      return activity.message.includes('Resumed interrupted session');
    });
    return lastResume ? new Date(lastResume.created_at).getTime() : null;
  }, [rawActivities]);

  const currentRunActivities = useMemo(() => {
    if (lastResumeAt === null) return rawActivities;
    return rawActivities.filter((activity) => new Date(activity.created_at).getTime() >= lastResumeAt);
  }, [rawActivities, lastResumeAt]);

  const historicalActivities = useMemo(() => {
    if (lastResumeAt === null) return [];
    return rawActivities.filter((activity) => new Date(activity.created_at).getTime() < lastResumeAt);
  }, [rawActivities, lastResumeAt]);

  const phaseSummaries = useMemo(() => {
    return buildPhaseSummaries(currentRunActivities, task?.status);
  }, [buildPhaseSummaries, currentRunActivities, task?.status]);

  const historicalPhaseSummaries = useMemo(() => {
    return buildPhaseSummaries(historicalActivities, task?.status);
  }, [buildPhaseSummaries, historicalActivities, task?.status]);

  const currentPhaseSteps = useMemo(() => new Set(phaseSummaries.map((phase) => phase.step)), [phaseSummaries]);
  const historicalPhaseSteps = useMemo(() => new Set(historicalPhaseSummaries.map((phase) => phase.step)), [historicalPhaseSummaries]);

  const finalResult = useMemo(() => {
    const sorted = rawActivities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const scoped = sorted.filter((activity) => {
      if (lastResumeAt === null) {
        return true;
      }
      return new Date(activity.created_at).getTime() >= lastResumeAt;
    });
    const completion = scoped.find((activity) => activity.activity_type === 'completed');
    const failure = scoped.find((activity) => {
      if (lastResumeAt !== null && new Date(activity.created_at).getTime() < lastResumeAt) {
        return false;
      }
      const lower = `${activity.activity_type} ${activity.message}`.toLowerCase();
      return lower.includes('fail') || lower.includes('error') || lower.includes('retry');
    });
    const latest = scoped[0] || sorted[0] || null;
    const isTerminal = task?.status === 'done' || Boolean(completion);
    const finalSignal = isTerminal ? (completion || latest) : latest;

    return {
      status: task?.status || 'unknown',
      summary: finalSignal ? summarizeTaskActivity(finalSignal) : 'No execution result captured yet.',
      failureSignal: failure ? summarizeTaskActivity(failure) : null,
      lastUpdated: finalSignal?.created_at || null,
      isTerminal,
    };
  }, [rawActivities, task?.status, lastResumeAt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading deliverables...</div>
      </div>
    );
  }

  const hasDeliverables = deliverables.length > 0;

  return (
    <div data-component="src/components/DeliverablesList" className="space-y-3">
      {!hasDeliverables && (
        <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          No deliverables are registered yet for this task. Runtime summaries and task changes are shown below.
        </div>
      )}

      <div className="p-3 bg-mc-bg rounded-lg border border-mc-border space-y-3">
        <div>
          <h4 className="font-medium text-mc-text">Phase Summaries</h4>
          <p className="text-xs text-mc-text-secondary mt-1">
            Runtime grouped by workflow phase and run segment. Attempts count re-dispatch/handoff loops; log entries count all activity events.
          </p>
        </div>

        {phaseSummaries.length === 0 ? (
          <div className="text-xs text-mc-text-secondary">No phase activity recorded yet.</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-mc-text-secondary mb-1">Current Run {lastResumeAt ? `(since ${formatTimestamp(new Date(lastResumeAt).toISOString())})` : '(full timeline)'}</div>
              {lastResumeAt && (
                <div className="text-[11px] text-mc-text-secondary mb-1">Only events after the most recent resume are shown here.</div>
              )}
              <div className="space-y-2">
                {phaseSummaries.map((phase) => (
                  <details key={`current-${phase.step}`} className="rounded border border-mc-border bg-mc-bg-secondary px-3 py-2">
                    <summary className="cursor-pointer text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between items-start gap-1.5 sm:gap-2">
                      <span className="font-medium text-mc-text">
                        {toTitleCaseLabel(phase.step)}
                        {historicalPhaseSteps.has(phase.step) ? ' (Current)' : ''}
                      </span>
                      <span className="text-xs text-mc-text-secondary">{phase.iterations} attempt(s) • {phase.activitiesCount} log entr{phase.activitiesCount === 1 ? 'y' : 'ies'}</span>
                    </summary>
                    <div className="mt-2 space-y-1">
                      {phase.highlights.map((line) => (
                        <div key={`current-${phase.step}-${line}`} className="text-xs text-mc-text-secondary">
                          {line}
                        </div>
                      ))}
                      {phase.latestAt && (
                        <div className="text-[11px] text-mc-text-secondary">Latest: {formatTimestamp(phase.latestAt)}</div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>

            {historicalPhaseSummaries.length > 0 && (
              <div>
                <div className="text-xs font-medium text-mc-text-secondary mb-1">Previous Runs (before last resume)</div>
                <div className="text-[11px] text-mc-text-secondary mb-1">These are earlier attempts from before the latest resume/re-dispatch.</div>
                <div className="space-y-2">
                  {historicalPhaseSummaries.map((phase) => (
                    <details key={`historical-${phase.step}`} className="rounded border border-mc-border bg-mc-bg-secondary/70 px-3 py-2">
                      <summary className="cursor-pointer text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between items-start gap-1.5 sm:gap-2">
                        <span className="font-medium text-mc-text">
                          {toTitleCaseLabel(phase.step)}
                          {currentPhaseSteps.has(phase.step) ? ' (Previous)' : ''}
                        </span>
                        <span className="text-xs text-mc-text-secondary">{phase.iterations} attempt(s) • {phase.activitiesCount} log entr{phase.activitiesCount === 1 ? 'y' : 'ies'}</span>
                      </summary>
                      <div className="mt-2 space-y-1">
                        {phase.highlights.map((line) => (
                          <div key={`historical-${phase.step}-${line}`} className="text-xs text-mc-text-secondary">
                            {line}
                          </div>
                        ))}
                        {phase.latestAt && (
                          <div className="text-[11px] text-mc-text-secondary">Latest: {formatTimestamp(phase.latestAt)}</div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded border border-mc-border bg-mc-bg-secondary px-3 py-2 space-y-1">
          <div className="text-sm font-medium text-mc-text">{finalResult.isTerminal ? 'Final Result' : 'Latest Runtime Snapshot'}</div>
          <div className="text-xs text-mc-text-secondary">{finalResult.isTerminal ? 'Status' : 'Status now'}: {toTitleCaseLabel(finalResult.status)}</div>
          {!finalResult.isTerminal && (
            <div className="text-[11px] text-mc-text-secondary">This reflects the latest runtime signal and may still change.</div>
          )}
          <div className="text-sm text-mc-text">{finalResult.summary}</div>
          {finalResult.failureSignal && (
            <div className="text-xs text-mc-accent-red">Latest failure signal: {finalResult.failureSignal}</div>
          )}
          {finalResult.lastUpdated && (
            <div className="text-[11px] text-mc-text-secondary">Updated: {formatTimestamp(finalResult.lastUpdated)}</div>
          )}
        </div>
      </div>

      {changes && (
        <div className="p-3 bg-mc-bg rounded-lg border border-mc-border space-y-3">
          <div>
            <h4 className="font-medium text-mc-text">Changes</h4>
            <p className="text-xs text-mc-text-secondary mt-1 break-words">
              Workspace: {changes.workspace.name || 'Unknown'}
              {changes.workspace.repo ? ` (${changes.workspace.repo})` : ''}
            </p>
            {(changes.workspace.worktree_name || changes.workspace.worktree_branch) && (
              <p className="text-xs text-mc-text-secondary mt-1">
                Worktree: {changes.workspace.worktree_name || 'n/a'}
                {changes.workspace.worktree_branch ? ` (${changes.workspace.worktree_branch})` : ''}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-mc-bg-tertiary">
              <div className="text-mc-text-secondary">Sessions</div>
              <div className="font-medium text-mc-text mt-0.5">{changes.summary.sessions_count}</div>
              <div className="text-[11px] text-mc-text-secondary mt-1">
                interrupted {changes.summary.interruptions_count || 0} • stale {changes.summary.stales_count || 0} • finished {changes.summary.finished_count || 0} • unfinished {changes.summary.unfinished_count || 0}
              </div>
            </div>
            <div className="p-2 rounded bg-mc-bg-tertiary">
              <div className="text-mc-text-secondary">Changed Files</div>
              <div className="font-medium text-mc-text mt-0.5">{changes.summary.changed_files_count}</div>
            </div>
            <div className="p-2 rounded bg-mc-bg-tertiary">
              <div className="text-mc-text-secondary">Commits</div>
              <div className="font-medium text-mc-text mt-0.5">{changes.summary.commits_count}</div>
            </div>
            <div className="p-2 rounded bg-mc-bg-tertiary">
              <div className="text-mc-text-secondary">Deliverables</div>
              <div className="font-medium text-mc-text mt-0.5">{changes.summary.deliverables_count}</div>
            </div>
          </div>

          {changes.changed_files.length > 0 && (
            <div>
              <div className="text-xs font-medium text-mc-text-secondary mb-1">Changed files</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {changes.changed_files.slice(0, 12).map((filePath) => (
                  <div key={filePath} className="text-xs font-mono text-mc-text-secondary truncate">
                    {filePath}
                  </div>
                ))}
              </div>
            </div>
          )}

          {changes.commits.length > 0 && (
            <div>
              <div className="text-xs font-medium text-mc-text-secondary mb-1">Recent commits</div>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {changes.commits.slice(0, 8).map((commit) => (
                  <div key={`${commit.hash}-${commit.subject}`} className="text-xs">
                    <div className="font-mono text-mc-accent">{commit.hash}</div>
                    <div className="text-mc-text truncate">{commit.subject}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasDeliverables && deliverables.map((deliverable) => (
        <div
          key={deliverable.id}
          onClick={() => handleOpen(deliverable)}
          className="flex flex-col sm:flex-row gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border hover:border-mc-accent transition-colors cursor-pointer"
        >
          {/* Icon */}
          <div className="flex-shrink-0 text-mc-accent">
            {getDeliverableIcon(deliverable.deliverable_type)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title - clickable */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              {deliverable.deliverable_type === 'url' && deliverable.path ? (
                <a
                  href={deliverable.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-mc-accent hover:text-mc-accent/80 hover:underline flex items-center gap-1.5"
                >
                  {deliverable.title}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <h4 className="font-medium text-mc-text">{deliverable.title}</h4>
              )}
              <div className="flex items-center gap-1 self-start sm:self-auto">
                {/* Preview button for previewable files */}
                {deliverable.deliverable_type === 'file' && isPreviewable(deliverable.path) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); void handlePreview(deliverable); }}
                    className="flex-shrink-0 p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-accent-cyan"
                    title="Preview in browser"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                )}
                {/* Download button for files */}
                {deliverable.deliverable_type === 'file' && deliverable.path && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(deliverable); }}
                    className="flex-shrink-0 p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary hover:text-mc-accent"
                    title="Download file"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                {/* Open/Reveal button */}
                {deliverable.path && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpen(deliverable); }}
                    className="flex-shrink-0 p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-accent"
                    title={deliverable.deliverable_type === 'url' ? 'Open URL' : 'Open file'}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Description */}
            {deliverable.description && (
              <p className="text-sm text-mc-text-secondary mt-1 break-words">
                {deliverable.description}
              </p>
            )}

            {(deliverable.created_via_workflow_step || deliverable.created_via_agent_name) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mc-text-secondary">
                {deliverable.created_via_workflow_step && (
                  <span>Stage: {toTitleCaseLabel(deliverable.created_via_workflow_step)}</span>
                )}
                {deliverable.created_via_agent_name && (
                  <span>Agent: {deliverable.created_via_agent_name}</span>
                )}
              </div>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-mc-text-secondary">
              <span className="capitalize">{deliverable.deliverable_type}</span>
              <span>•</span>
              <span>{formatTimestamp(deliverable.created_at)}</span>
              {deliverable.created_via_session_id && (
                <>
                  <span>•</span>
                  <span className="break-all">Session: {deliverable.created_via_session_id}</span>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {previewOpen && (
        <div className="fixed inset-0 z-[60] bg-mc-bg-secondary flex flex-col">
          <div className="p-3 border-b border-mc-border bg-mc-bg-tertiary flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-mc-text truncate">{previewTitle}</div>
              <div className="text-xs text-mc-text-secondary">Preview</div>
            </div>
            <button className="p-1.5 rounded hover:bg-mc-bg" onClick={() => setPreviewOpen(false)}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            {previewUrl && (
              <iframe
                title={previewTitle || 'Deliverable preview'}
                src={previewUrl}
                className="w-full h-full border-0"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
