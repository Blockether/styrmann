'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Activity, Filter, Loader2, CircleDot, Waypoints } from 'lucide-react';
import type { TaskActivity } from '@/lib/types';
import { TraceViewerModal } from './TraceViewerModal';
import { useTraceDeepLink } from '@/hooks/useTraceDeepLink';

interface ActivityLogProps {
  taskId: string;
}

interface ActivityResponse {
  activities: TaskActivity[];
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
  if (typeof metadata?.session_id === 'string' && metadata.session_id) {
    return metadata.session_id;
  }
  if (typeof metadata?.trace_url === 'string') {
    const match = metadata.trace_url.match(/\/sessions\/([^/]+)\/trace/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
  return null;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [filters, setFilters] = useState<ActivityResponse['filters']>({ agents: [], workflow_steps: [] });
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState('all');
  const [stepFilter, setStepFilter] = useState('all');
  const [decisionOnly, setDecisionOnly] = useState(false);
  const [openTraceOnFocus, setOpenTraceOnFocus] = useState(false);
  const { traceSessionId, openTrace, closeTrace } = useTraceDeepLink();

  useEffect(() => {
    const onFocus = (event: Event) => {
      const custom = event as CustomEvent<{ taskId?: string; agentId?: string; step?: string | null; decisionOnly?: boolean }>;
      if (!custom.detail || custom.detail.taskId !== taskId) return;
      setAgentFilter(custom.detail.agentId || 'all');
      setStepFilter(custom.detail.step || 'all');
      setDecisionOnly(Boolean(custom.detail.decisionOnly));
      setOpenTraceOnFocus(true);
    };

    window.addEventListener('mc:activity-focus', onFocus as EventListener);
    return () => window.removeEventListener('mc:activity-focus', onFocus as EventListener);
  }, [taskId]);

  const loadActivities = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(`/api/tasks/${taskId}/activities?limit=200`);
      const data = await res.json() as ActivityResponse;
      if (!res.ok) throw new Error('Failed to load activities');
      setActivities(Array.isArray(data.raw_activities) ? data.raw_activities : []);
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
        if (activity.agent_id !== agentFilter) return false;
      }
      if (stepFilter !== 'all' && activity.workflow_step !== stepFilter) return false;
      if (decisionOnly && !activity.decision_event) return false;
      return true;
    });
  }, [activities, agentFilter, stepFilter, decisionOnly]);

  const traceReadyCount = useMemo(
    () => visibleActivities.filter((activity) => Boolean(getTraceSessionId(activity))).length,
    [visibleActivities]
  );
  const decisionCount = useMemo(
    () => visibleActivities.filter((activity) => activity.decision_event).length,
    [visibleActivities]
  );

  useEffect(() => {
    if (!openTraceOnFocus || visibleActivities.length === 0) return;
    for (const activity of visibleActivities) {
      const traceId = getTraceSessionId(activity);
      if (traceId) {
        openTrace(traceId, taskId);
        setOpenTraceOnFocus(false);
        return;
      }
    }
    setOpenTraceOnFocus(false);
  }, [openTraceOnFocus, openTrace, taskId, visibleActivities]);

  if (loading) {
    return (
      <div data-component="src/components/ActivityLog" className="flex items-center justify-center py-8 text-mc-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading activity...
      </div>
    );
  }

  return (
    <div data-component="src/components/ActivityLog" className="space-y-4">
      <div className="overflow-hidden rounded-[1.1rem] border border-mc-border bg-mc-bg-secondary shadow-[0_18px_42px_-34px_rgba(120,90,20,0.35)]">
        <div className="border-b border-mc-border bg-mc-bg-secondary p-3 sm:p-4 flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
              <Activity className="w-4 h-4 text-mc-accent" />
              <span>Task Activity</span>
            </div>
            <p className="mt-1 text-xs text-mc-text-secondary">Live orchestration evidence with direct links into agent session traces.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-2 text-xs text-mc-text-secondary px-2 py-1 border border-mc-border rounded-full bg-white/80">
            <Filter className="w-3.5 h-3.5" />
            Current task filter active
          </div>
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="min-h-11 px-3 py-2 bg-white/80 border border-mc-border rounded-full text-sm">
            <option value="all">All Agents</option>
            {filters.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
            <select value={stepFilter} onChange={(event) => setStepFilter(event.target.value)} className="min-h-11 px-3 py-2 bg-white/80 border border-mc-border rounded-full text-sm">
            <option value="all">All Steps</option>
            {filters.workflow_steps.map((step) => (
              <option key={step} value={step}>{step}</option>
            ))}
          </select>
            <label className="inline-flex items-center gap-2 min-h-11 px-3 py-2 border border-mc-border rounded-full text-sm bg-white/80">
            <input type="checkbox" checked={decisionOnly} onChange={(event) => setDecisionOnly(event.target.checked)} />
            Decisions only
          </label>
          </div>
        </div>
        <div className="p-3 sm:p-4 border-b border-mc-border bg-mc-bg-tertiary/40">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-mc-border bg-white/80 text-mc-text-secondary">
              <CircleDot className="w-3.5 h-3.5" />
              Events in view: {visibleActivities.length}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700">
              <Waypoints className="w-3.5 h-3.5" />
              Trace ready: {traceReadyCount}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
              Decisions: {decisionCount}
            </span>
          </div>
        </div>
      </div>

      {visibleActivities.length === 0 ? (
        <div className="rounded-[1.1rem] border border-mc-border bg-mc-bg-secondary p-6 text-sm text-mc-text-secondary shadow-[0_16px_36px_-34px_rgba(0,0,0,0.25)]">
          No task activities match the current filters.
        </div>
      ) : (
        visibleActivities.map((activity) => {
          const metadata = parseMetadata(activity);
          const traceId = getTraceSessionId(activity);
          return (
            <div key={activity.id} className="rounded-[1.1rem] border border-mc-border bg-mc-bg-secondary p-4 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-2 flex-wrap text-xs text-mc-text-secondary">
                <span className="px-2 py-0.5 rounded-full bg-white/80 border border-mc-border">{activity.activity_type}</span>
                {activity.agent?.name && <span>{activity.agent.name}</span>}
                {activity.workflow_step && <span>step {activity.workflow_step}</span>}
                {activity.decision_event && <span className="text-amber-700">decision event</span>}
                <span>{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</span>
              </div>
              <div className="mt-2 text-sm text-mc-text whitespace-pre-wrap break-words">{activity.message}</div>
              <div className="mt-2 text-xs text-mc-text-secondary">{format(new Date(activity.created_at), 'yyyy-MM-dd HH:mm:ss')}</div>
              {traceId && (
                <button
                  type="button"
                  onClick={() => openTrace(traceId, taskId)}
                  className="mt-2 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-cyan-200 bg-cyan-50 text-cyan-700 rounded hover:bg-cyan-100"
                >
                  <Waypoints className="w-3.5 h-3.5" />
                  Open session trace
                </button>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-mc-text-secondary hover:text-mc-text">Show technical details</summary>
                <pre className="mt-2 p-2 bg-mc-bg rounded text-[11px] overflow-x-auto font-mono whitespace-pre-wrap break-words">{JSON.stringify(metadata || {}, null, 2)}</pre>
              </details>
            </div>
          );
        })
      )}

      <TraceViewerModal taskId={taskId} sessionId={traceSessionId} onClose={closeTrace} />
    </div>
  );
}
