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
  };
  summary: {
    sessions_count: number;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading deliverables...</div>
      </div>
    );
  }

  const hasDeliverables = deliverables.length > 0;

  const phaseSummaries = useMemo(() => {
    const grouped = new Map<string, TaskActivity[]>();
    for (const activity of rawActivities) {
      const step = typeof activity.workflow_step === 'string' && activity.workflow_step.trim().length > 0
        ? activity.workflow_step.trim()
        : 'general';
      if (!grouped.has(step)) grouped.set(step, []);
      grouped.get(step)?.push(activity);
    }

    const phaseOrder = task?.status
      ? [task.status, ...Array.from(grouped.keys()).filter((step) => step !== task.status)]
      : Array.from(grouped.keys());

    return phaseOrder
      .filter((step) => grouped.has(step))
      .map((step) => {
        const activities = (grouped.get(step) || []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const iterations = activities.reduce((count, activity) => {
          const isIteration = activity.activity_type === 'dispatch_invocation'
            || (activity.activity_type === 'status_changed' && activity.message.startsWith('Stage handoff:'))
            || (activity.activity_type === 'status_changed' && activity.message.startsWith('[Auto-Recovery]'));
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
  }, [rawActivities, task?.status]);

  const finalResult = useMemo(() => {
    const sorted = rawActivities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const completion = sorted.find((activity) => activity.activity_type === 'completed');
    const failure = sorted.find((activity) => {
      const lower = `${activity.activity_type} ${activity.message}`.toLowerCase();
      return lower.includes('fail') || lower.includes('error') || lower.includes('retry');
    });
    const latest = sorted[0] || null;
    const finalSignal = completion || latest;

    return {
      status: task?.status || 'unknown',
      summary: finalSignal ? summarizeTaskActivity(finalSignal) : 'No execution result captured yet.',
      failureSignal: failure ? summarizeTaskActivity(failure) : null,
      lastUpdated: finalSignal?.created_at || null,
    };
  }, [rawActivities, task?.status]);

  return (
    <div data-component="src/components/DeliverablesList" className="space-y-3">
      <div className="p-3 bg-mc-bg rounded-lg border border-mc-border space-y-3">
        <div>
          <h4 className="font-medium text-mc-text">Phase Summaries</h4>
          <p className="text-xs text-mc-text-secondary mt-1">
            Runtime grouped by workflow phases with iteration counts and highlights.
          </p>
        </div>

        {phaseSummaries.length === 0 ? (
          <div className="text-xs text-mc-text-secondary">No phase activity recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {phaseSummaries.map((phase) => (
              <details key={phase.step} className="rounded border border-mc-border bg-mc-bg-secondary px-3 py-2">
                <summary className="cursor-pointer text-sm flex items-center justify-between gap-2">
                  <span className="font-medium text-mc-text">{phase.step.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-mc-text-secondary">{phase.iterations} iteration(s) • {phase.activitiesCount} event(s)</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {phase.highlights.map((line) => (
                    <div key={`${phase.step}-${line}`} className="text-xs text-mc-text-secondary">
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
        )}

        <div className="rounded border border-mc-border bg-mc-bg-secondary px-3 py-2 space-y-1">
          <div className="text-sm font-medium text-mc-text">Final Result</div>
          <div className="text-xs text-mc-text-secondary">Status: {finalResult.status.replace(/_/g, ' ')}</div>
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
            <p className="text-xs text-mc-text-secondary mt-1">
              Workspace: {changes.workspace.name || 'Unknown'}
              {changes.workspace.repo ? ` (${changes.workspace.repo})` : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-mc-bg-tertiary">
              <div className="text-mc-text-secondary">Sessions</div>
              <div className="font-medium text-mc-text mt-0.5">{changes.summary.sessions_count}</div>
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

      {!hasDeliverables && (
        <div className="text-center py-6 text-sm text-mc-text-secondary">No deliverables registered for this task yet.</div>
      )}

      {hasDeliverables && deliverables.map((deliverable) => (
        <div
          key={deliverable.id}
          onClick={() => handleOpen(deliverable)}
          className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border hover:border-mc-accent transition-colors cursor-pointer"
        >
          {/* Icon */}
          <div className="flex-shrink-0 text-mc-accent">
            {getDeliverableIcon(deliverable.deliverable_type)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title - clickable */}
            <div className="flex items-start justify-between gap-2">
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
              <div className="flex items-center gap-1">
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
              <p className="text-sm text-mc-text-secondary mt-1">
                {deliverable.description}
              </p>
            )}

            {/* Metadata */}
            <div className="flex items-center gap-4 mt-2 text-xs text-mc-text-secondary">
              <span className="capitalize">{deliverable.deliverable_type}</span>
              <span>•</span>
              <span>{formatTimestamp(deliverable.created_at)}</span>
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
