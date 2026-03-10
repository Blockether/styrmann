'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Activity, ChevronDown, ChevronRight, Filter, Loader2 } from 'lucide-react';
import type { PresentedTaskActivity, TaskActivity } from '@/lib/types';
import { AgentInitials } from './AgentInitials';
import { TraceViewerModal } from './TraceViewerModal';
import { useTraceDeepLink } from '@/hooks/useTraceDeepLink';

interface ActivityLogProps {
  taskId: string;
}

interface ActivityResponse {
  activities: PresentedTaskActivity[];
  raw_activities: TaskActivity[];
  filters: {
    agents: Array<{ id: string; name: string }>;
    workflow_steps: string[];
  };
}

function parseMetadata(activity: TaskActivity): Record<string, unknown> | null {
  if (activity.technical_details) return activity.technical_details;
  if (!activity.metadata) return null;
  try {
    const parsed = JSON.parse(activity.metadata);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function getTraceSessionId(activity: TaskActivity): string | null {
  const metadata = parseMetadata(activity);
  if (typeof metadata?.openclaw_session_id === 'string' && metadata.openclaw_session_id) {
    return metadata.openclaw_session_id;
  }
  if (typeof metadata?.trace_url === 'string') {
    const match = metadata.trace_url.match(/\/sessions\/([^/]+)\/trace/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
  return null;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const [activities, setActivities] = useState<PresentedTaskActivity[]>([]);
  const [filters, setFilters] = useState<ActivityResponse['filters']>({ agents: [], workflow_steps: [] });
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState('all');
  const [stepFilter, setStepFilter] = useState('all');
  const [decisionOnly, setDecisionOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { traceSessionId, openTrace, closeTrace } = useTraceDeepLink();

  const loadActivities = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(`/api/tasks/${taskId}/activities?limit=200`);
      const data = await res.json() as ActivityResponse;
      if (!res.ok) throw new Error('Failed to load activities');
      setActivities(Array.isArray(data.activities) ? data.activities : []);
      setFilters(data.filters || { agents: [], workflow_steps: [] });
    } catch (error) {
      console.error('Failed to load activities:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadActivities(true);
  }, [loadActivities]);

  useEffect(() => {
    const onActivity = () => loadActivities(false);
    window.addEventListener('mc:activity-logged', onActivity);
    window.addEventListener('mc:activity-presented', onActivity);
    window.addEventListener('mc:task-updated', onActivity);
    return () => {
      window.removeEventListener('mc:activity-logged', onActivity);
      window.removeEventListener('mc:activity-presented', onActivity);
      window.removeEventListener('mc:task-updated', onActivity);
    };
  }, [loadActivities]);

  const visibleActivities = useMemo(() => {
    return activities.filter((activity) => {
      if (agentFilter !== 'all') {
        const rawAgents = activity.raw_activities.map((raw) => raw.agent_id).filter(Boolean);
        if (!rawAgents.includes(agentFilter)) return false;
      }
      if (stepFilter !== 'all' && activity.workflow_step !== stepFilter) return false;
      if (decisionOnly && !activity.decision_event) return false;
      return true;
    });
  }, [activities, agentFilter, stepFilter, decisionOnly]);

  if (loading) {
    return (
      <div data-component="src/components/ActivityLog" className="flex items-center justify-center py-8 text-mc-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading activity...
      </div>
    );
  }

  return (
    <div data-component="src/components/ActivityLog" className="space-y-4">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap rounded-lg">
        <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
          <Activity className="w-4 h-4 text-mc-text-secondary" />
          <span>Presenter Activity</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 text-xs text-mc-text-secondary px-2 py-1 border border-mc-border rounded">
            <Filter className="w-3.5 h-3.5" />
            Current task filter active
          </div>
          <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm">
            <option value="all">All Agents</option>
            {filters.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <select value={stepFilter} onChange={(event) => setStepFilter(event.target.value)} className="min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm">
            <option value="all">All Steps</option>
            {filters.workflow_steps.map((step) => (
              <option key={step} value={step}>{step}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 min-h-11 px-3 py-2 border border-mc-border rounded text-sm">
            <input type="checkbox" checked={decisionOnly} onChange={(event) => setDecisionOnly(event.target.checked)} />
            Decisions only
          </label>
        </div>
      </div>

      {visibleActivities.length === 0 ? (
        <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-6 text-sm text-mc-text-secondary">
          No presenter summaries match the current filters.
        </div>
      ) : (
        visibleActivities.map((activity) => {
          const isExpanded = expanded.has(activity.id);
          return (
            <div key={activity.id} className="rounded-lg border border-mc-border bg-mc-bg-secondary overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(activity.id)) next.delete(activity.id);
                  else next.add(activity.id);
                  return next;
                })}
                className="w-full text-left p-4 hover:bg-mc-bg-tertiary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 mt-1 text-mc-text-secondary" /> : <ChevronRight className="w-4 h-4 mt-1 text-mc-text-secondary" />}
                    {activity.agent ? <AgentInitials name={activity.agent.name} size="sm" /> : <div className="w-6 h-6 rounded-full bg-mc-bg border border-mc-border" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded bg-mc-accent/15 text-mc-accent">Presenter</span>
                        {activity.workflow_step && <span className="text-xs px-2 py-0.5 rounded border border-mc-border text-mc-text-secondary">{activity.workflow_step}</span>}
                        <span className="text-xs px-2 py-0.5 rounded border border-mc-border text-mc-text-secondary">{activity.summary_kind === 'live' ? 'live interpretation' : 'post-step consolidation'}</span>
                        {activity.decision_event && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">decision</span>}
                      </div>
                      <div className="mt-2 text-sm text-mc-text">{activity.message}</div>
                      <div className="mt-2 text-xs text-mc-text-secondary">
                        {activity.raw_activities.length} technical event(s) consolidated · {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-mc-border p-4 space-y-3 bg-mc-bg">
                  {activity.raw_activities.map((raw) => {
                    const metadata = parseMetadata(raw);
                    const traceId = getTraceSessionId(raw);
                    return (
                      <div key={raw.id} className="rounded border border-mc-border bg-mc-bg-secondary p-3">
                        <div className="flex items-center gap-2 flex-wrap text-xs text-mc-text-secondary">
                          <span className="px-2 py-0.5 rounded bg-mc-bg border border-mc-border">{raw.activity_type}</span>
                          {raw.agent?.name && <span>{raw.agent.name}</span>}
                          {raw.workflow_step && <span>step {raw.workflow_step}</span>}
                          {raw.decision_event && <span className="text-amber-700">decision event</span>}
                        </div>
                        <div className="mt-2 text-sm text-mc-text whitespace-pre-wrap break-words">{raw.message}</div>
                        {traceId && (
                          <button type="button" onClick={() => openTrace(traceId, taskId)} className="mt-2 text-xs text-mc-accent hover:underline">
                            Open session trace
                          </button>
                        )}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-mc-text-secondary hover:text-mc-text">Show technical details</summary>
                          <pre className="mt-2 p-2 bg-mc-bg rounded text-[11px] overflow-x-auto font-mono whitespace-pre-wrap break-words">{JSON.stringify(metadata || {}, null, 2)}</pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <TraceViewerModal taskId={taskId} sessionId={traceSessionId} onClose={closeTrace} />
    </div>
  );
}
