/**
 * SessionsList Component
 * Displays OpenClaw sessions for a task
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bot, Circle, XCircle, Shield, AlertTriangle, Waypoints } from 'lucide-react';
import { AgentInitials } from './AgentInitials';
import { TraceViewerModal } from './TraceViewerModal';
import { useTraceDeepLink } from '@/hooks/useTraceDeepLink';

interface SessionWithAgent {
  id: string;
  agent_id: string | null;
  openclaw_session_id: string;
  channel: string | null;
  status: string;
  session_type: string;
  task_id: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  trace_url?: string;
  is_active?: boolean;
  inactivity_minutes?: number | null;
  resumed_via_session_continuation?: boolean;
  resumed_at?: string | null;
}

interface ProvenanceSummary {
  count: number;
  records: Array<{
    kind: string;
    source_tool: string | null;
    source_channel: string | null;
    receipt_data: Record<string, string | undefined> | null;
  }>;
}

interface SessionsListProps {
  taskId: string;
}

export function SessionsList({ taskId }: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionWithAgent[]>([]);
  const [provenance, setProvenance] = useState<ProvenanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const { traceSessionId, openTrace, closeTrace } = useTraceDeepLink();

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const refresh = () => {
      void loadSessions();
    };
    const intervalId = window.setInterval(refresh, 30000);
    window.addEventListener('mc:task-updated', refresh);
    window.addEventListener('mc:activity-logged', refresh);
    window.addEventListener('mc:activity-presented', refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('mc:task-updated', refresh);
      window.removeEventListener('mc:activity-logged', refresh);
      window.removeEventListener('mc:activity-presented', refresh);
    };
  }, [loadSessions]);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/provenance`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setProvenance(data as ProvenanceSummary); })
      .catch(() => {});
  }, [taskId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Circle className="w-4 h-4 text-green-500 fill-current animate-pulse" />;
      case 'completed':
        return <Circle className="w-4 h-4 text-mc-text-secondary" />;
      case 'interrupted':
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'stale':
        return <AlertTriangle className="w-4 h-4 text-mc-accent-yellow" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Circle className="w-4 h-4 text-mc-text-secondary" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Running';
      case 'completed':
        return 'Ended';
      case 'interrupted':
        return 'Interrupted';
      case 'stale':
        return 'Stale';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  const activeCount = sessions.filter((session) => session.is_active).length;
  const inactiveCount = sessions.length - activeCount;
  const interruptedCount = sessions.filter((session) => session.status === 'interrupted').length;
  const staleCount = sessions.filter((session) => session.status === 'stale').length;
  const finishedCount = sessions.filter((session) => session.status === 'completed' || Boolean(session.ended_at)).length;
  const unfinishedCount = sessions.length - finishedCount;
  const traceLinkedCount = sessions.filter((session) => Boolean(session.trace_url)).length;

  const formatDuration = (start: string, end?: string | null) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const duration = endTime - startTime;

    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
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

  const handleResumeInterrupted = async (sessionId: string) => {
    try {
      const resumeRes = await fetch(`/api/tasks/${taskId}/sessions/${encodeURIComponent(sessionId)}/resume`, {
        method: 'POST',
      });
      if (resumeRes.ok) {
        loadSessions();
      }
    } catch (error) {
      console.error('Failed to resume interrupted session:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-mc-text-secondary">Loading sessions...</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-mc-text-secondary">
        <Bot className="w-10 h-10 text-mc-text-secondary mb-2" />
        <p>No sessions yet</p>
      </div>
    );
  }

  return (
    <div data-component="src/components/SessionsList" className="space-y-3 max-w-full overflow-x-hidden">
      <div className="p-3 rounded-lg border border-mc-border bg-mc-bg-secondary text-xs flex items-center justify-between gap-2 flex-wrap">
        <span className="text-mc-text-secondary">OpenClaw session state and trace readiness</span>
        <div className="flex flex-wrap items-center gap-2 justify-start">
          <span className="px-2 py-0.5 rounded border border-green-200 bg-green-50 text-green-700 whitespace-nowrap">Active: {activeCount}</span>
          <span className="px-2 py-0.5 rounded border border-mc-border bg-mc-bg text-mc-text-secondary whitespace-nowrap">Inactive: {inactiveCount}</span>
          <span className="px-2 py-0.5 rounded border border-orange-200 bg-orange-50 text-orange-700 whitespace-nowrap">Interrupted: {interruptedCount}</span>
          <span className="px-2 py-0.5 rounded border border-yellow-200 bg-yellow-50 text-yellow-700 whitespace-nowrap">Stale: {staleCount}</span>
          <span className="px-2 py-0.5 rounded border border-mc-border bg-mc-bg text-mc-text-secondary whitespace-nowrap">Finished: {finishedCount}</span>
          <span className="px-2 py-0.5 rounded border border-mc-border bg-mc-bg text-mc-text-secondary whitespace-nowrap">Unfinished: {unfinishedCount}</span>
          <span className="px-2 py-0.5 rounded border border-cyan-200 bg-cyan-50 text-cyan-700 whitespace-nowrap">Trace linked: {traceLinkedCount}</span>
        </div>
      </div>

      {/* ACP Provenance Banner */}
      {provenance && provenance.count > 0 && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 text-amber-800 font-medium">
            <Shield className="w-3.5 h-3.5" />
            ACP Provenance ({provenance.count} {provenance.count === 1 ? 'record' : 'records'})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set(provenance.records.map((r) => r.kind))).map((kind) => (
              <span key={kind} className="px-1.5 py-0.5 rounded border border-amber-200 bg-white/60 text-amber-700">
                {kind === 'external_user' ? 'External (ACP Bridge)' : kind === 'inter_session' ? 'Inter-Session' : kind}
              </span>
            ))}
          </div>
          {provenance.records.some((r) => r.source_tool) && (
            <div className="text-amber-700">
              Tools: {Array.from(new Set(provenance.records.filter((r) => r.source_tool).map((r) => r.source_tool))).join(', ')}
            </div>
          )}
        </div>
      )}
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border"
        >
          {/* Agent Avatar */}
          <div className="flex-shrink-0">
            {session.agent_name ? (
              <AgentInitials name={session.agent_name} size="md" />
            ) : (
              <Bot className="w-8 h-8 text-mc-accent" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Agent name and status */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {getStatusIcon(session.status)}
              <span className="font-medium text-mc-text">
                {session.agent_name || 'Session Agent'}
              </span>
                <span className="text-xs text-mc-text-secondary capitalize whitespace-nowrap">
                  {getStatusLabel(session.status)}
                </span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap ${session.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-mc-border bg-mc-bg text-mc-text-secondary'}`}>
                  {session.is_active ? 'active' : 'inactive'}
                </span>
                {session.resumed_via_session_continuation && session.is_active && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-cyan-200 bg-cyan-50 text-cyan-700 whitespace-nowrap">
                    resumed via continuation
                  </span>
                )}
              </div>

            {/* Session ID */}
            <div className="text-xs text-mc-text-secondary font-mono mb-2 truncate">
              Session: {session.openclaw_session_id}
            </div>

            {session.trace_url && (
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => openTrace(session.openclaw_session_id, taskId)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-cyan-200 bg-cyan-50 text-cyan-700 rounded hover:bg-cyan-100"
                >
                  <Waypoints className="w-3.5 h-3.5" />
                  View full trace
                </button>
              </div>
            )}

            {/* Duration and timestamps */}
            <div className="flex items-center gap-3 text-xs text-mc-text-secondary">
              <span>
                Duration: {formatDuration(session.created_at, session.ended_at)}
              </span>
              <span>•</span>
              <span>Started {formatTimestamp(session.created_at)}</span>
              {typeof session.inactivity_minutes === 'number' && (
                <>
                  <span>•</span>
                  <span>Idle {session.inactivity_minutes}m</span>
                </>
              )}
              {session.resumed_via_session_continuation && session.resumed_at && session.is_active && (
                <>
                  <span>•</span>
                  <span>Resumed {formatTimestamp(session.resumed_at)}</span>
                </>
              )}
            </div>

            {/* Channel */}
            {session.channel && (
              <div className="mt-2 text-xs text-mc-text-secondary">
                Channel: <span className="font-mono">{session.channel}</span>
              </div>
            )}

            {session.status === 'stale' && (
              <div className="mt-2 text-xs text-mc-accent-yellow">
                No explicit session end was recorded; task/activity suggests this run is no longer active.
              </div>
            )}
            {session.status === 'interrupted' && !session.resumed_via_session_continuation && (
              <div className="mt-2 text-xs text-orange-600">
                Session heartbeat stopped. Resume will continue this exact session in OpenClaw.
              </div>
            )}
            {session.status === 'interrupted' && session.resumed_via_session_continuation && (
              <div className="mt-2 text-xs text-orange-600">
                This run resumed earlier, then became interrupted again due to inactivity. Tap Resume to continue the same session.
                {session.resumed_at ? ` Last resume: ${formatTimestamp(session.resumed_at)}.` : ''}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-1 items-end">
            {session.status === 'interrupted' && (
              <button
                onClick={() => handleResumeInterrupted(session.openclaw_session_id)}
                className="px-2 py-1 text-[11px] border border-orange-200 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 whitespace-nowrap"
                title="Resume interrupted session"
              >
                Resume
              </button>
            )}
          </div>
        </div>
      ))}
      <TraceViewerModal
        taskId={taskId}
        sessionId={traceSessionId}
        onClose={closeTrace}
      />
    </div>
  );
}
