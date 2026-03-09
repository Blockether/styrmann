'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Bot, User, Cpu, Clock3, MessageSquare, ChevronRight } from 'lucide-react';

interface TraceMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface TracePayload {
  task_id: string;
  openclaw_session_id: string;
  agent_name: string | null;
  session_key: string | null;
  invocation?: {
    session_id: string;
    session_key: string;
    output_directory: string;
    invocation: string;
    created_at: string;
  } | null;
  summary?: {
    message_count: number;
    role_counts: Record<string, number>;
    started_at: string | null;
    ended_at: string | null;
    duration_seconds: number | null;
    stage_flow: string[];
    highlights: string[];
  };
  history: TraceMessage[];
}

interface TraceViewerModalProps {
  taskId?: string;
  traceUrl: string | null;
  onClose: () => void;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) return 'n/a';
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function roleIcon(role: string) {
  if (role === 'assistant') return <Bot className="w-3.5 h-3.5" />;
  if (role === 'user') return <User className="w-3.5 h-3.5" />;
  return <Cpu className="w-3.5 h-3.5" />;
}

function roleBadge(role: string): string {
  if (role === 'assistant') return 'bg-mc-accent/20 text-mc-accent';
  if (role === 'user') return 'bg-blue-100 text-blue-700';
  return 'bg-mc-bg-tertiary text-mc-text-secondary';
}

export function TraceViewerModal({ taskId, traceUrl, onClose }: TraceViewerModalProps) {
  const [data, setData] = useState<TracePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPath = useMemo(() => {
    if (!traceUrl) return null;
    if (traceUrl.startsWith('/')) return traceUrl;
    try {
      const parsed = new URL(traceUrl);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return traceUrl;
    }
  }, [traceUrl]);

  useEffect(() => {
    if (!normalizedPath) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let isCancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(normalizedPath);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load trace');
        }
        if (!isCancelled) {
          setData(payload as TracePayload);
        }
      } catch (fetchError) {
        if (!isCancelled) {
          setData(null);
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load trace');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    run().catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [normalizedPath]);

  if (!normalizedPath) return null;

  const summary = data?.summary;
  const previewMessages = (data?.history || []).slice(0, 16);

  return (
    <div
      data-component="src/components/TraceViewerModal"
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-mc-bg-secondary border border-mc-border rounded-none sm:rounded-lg w-full sm:w-[92vw] lg:w-[80vw] max-w-6xl h-[95vh] sm:h-[90vh] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium text-mc-text truncate">Session Trace</div>
            <div className="text-xs text-mc-text-secondary font-mono truncate">
              {data?.openclaw_session_id || 'Loading...'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-mc-bg-tertiary"
            aria-label="Close trace viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <div className="text-sm text-mc-text-secondary">Loading trace...</div>}

          {!loading && error && (
            <div className="p-3 border border-red-400/40 bg-red-500/10 text-sm text-red-400 rounded">
              Failed to load trace{taskId ? ` for task \`${taskId}\`` : ''}: {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="p-2 rounded bg-mc-bg border border-mc-border">
                  <div className="text-mc-text-secondary flex items-center gap-1"><MessageSquare className="w-3 h-3" />Messages</div>
                  <div className="text-mc-text font-medium mt-0.5">{summary?.message_count ?? data.history.length}</div>
                </div>
                <div className="p-2 rounded bg-mc-bg border border-mc-border">
                  <div className="text-mc-text-secondary flex items-center gap-1"><Clock3 className="w-3 h-3" />Duration</div>
                  <div className="text-mc-text font-medium mt-0.5">{formatDuration(summary?.duration_seconds)}</div>
                </div>
                <div className="p-2 rounded bg-mc-bg border border-mc-border">
                  <div className="text-mc-text-secondary">Started</div>
                  <div className="text-mc-text font-medium mt-0.5">{formatTimestamp(summary?.started_at)}</div>
                </div>
                <div className="p-2 rounded bg-mc-bg border border-mc-border">
                  <div className="text-mc-text-secondary">Ended</div>
                  <div className="text-mc-text font-medium mt-0.5">{formatTimestamp(summary?.ended_at)}</div>
                </div>
              </div>

              {summary?.stage_flow && summary.stage_flow.length > 0 && (
                <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Stage flow</div>
                  <div className="flex items-center flex-wrap gap-1.5 text-xs">
                    {summary.stage_flow.map((stage, index) => (
                      <div key={`${stage}-${index}`} className="flex items-center gap-1 text-mc-text">
                        {index > 0 && <ChevronRight className="w-3 h-3 text-mc-text-secondary" />}
                        <span className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border">{stage}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary?.highlights && summary.highlights.length > 0 && (
                <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Highlights</div>
                  <div className="space-y-1.5">
                    {summary.highlights.map((line, index) => (
                      <p key={`${line}-${index}`} className="text-sm text-mc-text">{line}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Trace preview</div>
                <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                  {previewMessages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className="p-2 rounded border border-mc-border bg-mc-bg-secondary">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${roleBadge(message.role)}`}>
                          {roleIcon(message.role)}
                          {message.role}
                        </span>
                        <span className="text-[11px] text-mc-text-secondary">{formatTimestamp(message.timestamp)}</span>
                      </div>
                      <p className="text-xs text-mc-text whitespace-pre-wrap break-words line-clamp-4">{message.content || '(empty message)'}</p>
                    </div>
                  ))}
                </div>
              </div>

              <details className="p-3 rounded border border-mc-border bg-mc-bg">
                <summary className="cursor-pointer text-sm text-mc-text">Technical details</summary>
                <div className="mt-2 space-y-2 text-xs">
                  <div className="text-mc-text-secondary">Session key: <span className="font-mono">{data.session_key || 'n/a'}</span></div>
                  {data.invocation?.output_directory && (
                    <div className="text-mc-text-secondary break-all">Artifacts: <span className="font-mono">{data.invocation.output_directory}</span></div>
                  )}
                  <pre className="p-2 rounded bg-mc-bg-secondary border border-mc-border overflow-x-auto text-[11px] text-mc-text-secondary whitespace-pre-wrap break-words">
                    {JSON.stringify({ summary: data.summary, invocation: data.invocation }, null, 2)}
                  </pre>
                </div>
              </details>
            </>
          )}
        </div>

        <div className="border-t border-mc-border bg-mc-bg-secondary p-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-3 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
