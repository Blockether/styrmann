'use client';

import { useEffect, useState } from 'react';
import { X, Bot, User, Cpu, Clock3, MessageSquare, ChevronRight, Shield, ArrowRight, Wrench, Terminal } from 'lucide-react';

interface TraceMessage {
  role: string;
  content: string;
  tool_calls?: { name: string; input?: string }[];
  tool_result?: string;
  timestamp?: string;
  provenance?: {
    kind: string;
    originSessionId?: string;
    sourceSessionKey?: string;
    sourceChannel?: string;
    sourceTool?: string;
  } | null;
  receipt?: Record<string, string | undefined> | null;
}

interface ProvenanceEntry {
  kind: string;
  origin_session_id: string | null;
  source_channel: string | null;
  source_tool: string | null;
  receipt: Record<string, string | undefined> | null;
  message_role: string;
  message_index: number;
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
  provenance?: ProvenanceEntry[];
  history: TraceMessage[];
}

interface TraceViewerModalProps {
  taskId: string;
  sessionId: string | null;
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

function roleLabel(role: string): string {
  if (role === 'assistant') return 'assistant';
  if (role === 'user') return 'user';
  if (role === 'tool' || role === 'toolResult') return 'tool output';
  return role;
}

function roleIcon(role: string) {
  if (role === 'assistant') return <Bot className="w-3.5 h-3.5" />;
  if (role === 'user') return <User className="w-3.5 h-3.5" />;
  if (role === 'tool' || role === 'toolResult') return <Terminal className="w-3.5 h-3.5" />;
  return <Cpu className="w-3.5 h-3.5" />;
}

function roleBadge(role: string): string {
  if (role === 'assistant') return 'bg-mc-accent/20 text-mc-accent';
  if (role === 'user') return 'bg-blue-100 text-blue-700';
  if (role === 'tool' || role === 'toolResult') return 'bg-emerald-100 text-emerald-700';
  return 'bg-mc-bg-tertiary text-mc-text-secondary';
}

function kindLabel(kind: string): string {
  if (kind === 'external_user') return 'External (ACP Bridge)';
  if (kind === 'inter_session') return 'Inter-Session (ACPX)';
  if (kind === 'internal_system') return 'Internal System';
  return kind;
}

function kindBadgeClass(kind: string): string {
  if (kind === 'external_user') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (kind === 'inter_session') return 'bg-purple-100 text-purple-800 border-purple-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

export function TraceViewerModal({ taskId, sessionId, onClose }: TraceViewerModalProps) {
  const [data, setData] = useState<TracePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
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
        const url = `/api/tasks/${taskId}/sessions/${encodeURIComponent(sessionId)}/trace`;
        const response = await fetch(url);
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
  }, [taskId, sessionId]);

  if (!sessionId) return null;

  const summary = data?.summary;
  const previewMessages = data?.history || [];

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

              {data.provenance && data.provenance.length > 0 && (
                <div className="p-3 rounded border border-amber-200 bg-amber-50 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    ACP Provenance
                  </div>
                  <div className="space-y-2">
                    {/* Provenance chain badges */}
                    <div className="flex items-center flex-wrap gap-1.5 text-xs">
                      {Array.from(new Set(data.provenance.map((p) => p.kind))).map((kind, idx) => (
                        <div key={kind} className="flex items-center gap-1">
                          {idx > 0 && <ArrowRight className="w-3 h-3 text-amber-600" />}
                          <span className={`px-2 py-1 rounded border text-[11px] font-medium ${kindBadgeClass(kind)}`}>
                            {kindLabel(kind)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Receipt details */}
                    {data.provenance.filter((p) => p.receipt).map((p, idx) => (
                      <div key={`receipt-${idx}`} className="text-xs bg-white/60 rounded border border-amber-200 p-2 space-y-1 font-mono">
                        {p.receipt?.bridge && <div><span className="text-amber-700">bridge:</span> {p.receipt.bridge}</div>}
                        {p.receipt?.originHost && <div><span className="text-amber-700">host:</span> {p.receipt.originHost}</div>}
                        {p.receipt?.originCwd && <div><span className="text-amber-700">cwd:</span> <span className="break-all">{p.receipt.originCwd}</span></div>}
                        {p.receipt?.acpSessionId && <div><span className="text-amber-700">acp-session:</span> <span className="break-all">{p.receipt.acpSessionId}</span></div>}
                        {p.receipt?.originSessionId && <div><span className="text-amber-700">origin-session:</span> <span className="break-all">{p.receipt.originSessionId}</span></div>}
                        {p.receipt?.targetSession && <div><span className="text-amber-700">target:</span> <span className="break-all">{p.receipt.targetSession}</span></div>}
                      </div>
                    ))}
                    <div className="text-[11px] text-amber-700">
                      {data.provenance.length} provenance {data.provenance.length === 1 ? 'record' : 'records'} detected in session messages
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Trace preview ({previewMessages.length} messages)</div>
                <div className="space-y-2">
                  {previewMessages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className="p-2 rounded border border-mc-border bg-mc-bg-secondary">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${roleBadge(message.role)}`}>
                          {roleIcon(message.role)}
                          {roleLabel(message.role)}
                        </span>
                        <span className="text-[11px] text-mc-text-secondary">{formatTimestamp(message.timestamp)}</span>
                      </div>
                      {message.content && (message.role === 'toolResult' || message.role === 'tool') ? (
                        <pre className="text-xs p-1.5 mt-1 rounded bg-mc-bg border border-mc-border font-mono text-mc-text-secondary whitespace-pre-wrap break-words overflow-x-auto max-h-48">{message.content}</pre>
                      ) : message.content ? (
                        <p className="text-xs text-mc-text whitespace-pre-wrap break-words">{message.content}</p>
                      ) : null}
                      {message.tool_calls && message.tool_calls.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {message.tool_calls.map((tc, tcIdx) => (
                            <div key={`tc-${tcIdx}`} className="flex items-start gap-1.5 text-xs">
                              <Wrench className="w-3 h-3 mt-0.5 text-mc-text-secondary flex-shrink-0" />
                              <div className="min-w-0">
                                <span className="font-mono font-medium text-mc-accent">{tc.name}</span>
                                {tc.input && (
                                  <pre className="mt-0.5 p-1.5 rounded bg-mc-bg border border-mc-border text-[11px] text-mc-text-secondary overflow-x-auto max-h-32 whitespace-pre-wrap break-words">{tc.input.length > 500 ? `${tc.input.slice(0, 500)}...` : tc.input}</pre>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {message.tool_result && (
                        <div className="mt-1 flex items-start gap-1.5 text-xs">
                          <Terminal className="w-3 h-3 mt-0.5 text-emerald-600 flex-shrink-0" />
                          <pre className="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 overflow-x-auto max-h-32 whitespace-pre-wrap break-words min-w-0 flex-1">{message.tool_result.length > 500 ? `${message.tool_result.slice(0, 500)}...` : message.tool_result}</pre>
                        </div>
                      )}
                      {!message.content && !message.tool_calls?.length && !message.tool_result && (
                        <p className="text-xs text-mc-text-secondary italic">(empty message)</p>
                      )}
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
