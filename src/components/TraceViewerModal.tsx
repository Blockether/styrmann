'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Bot, User, Cpu, Clock3, MessageSquare, Shield, ArrowRight, ArrowDown, Wrench, Terminal, Search, AlertTriangle, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { marked } from 'marked';
import { useScrollLock } from '@/hooks/useScrollLock';

interface TraceMessage {
  role: string;
  content: string;
  tool_calls?: { id?: string; name: string; input?: string }[];
  tool_result?: string;
  tool_name?: string;
  tool_call_id?: string;
  is_error?: boolean;
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
  session_id: string;
  agent_name: string | null;
  session_key: string | null;
  session?: {
    id: string;
    status: string | null;
    session_type: string | null;
    channel: string | null;
    created_at: string | null;
    ended_at: string | null;
  };
  diagnostics?: {
    candidate_session_keys?: string[];
    resolved_session_key?: string | null;
    history_source?: string;
  };
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
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) return 'Not available';
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function roleLabel(role: string, toolName?: string): string {
  if (role === 'assistant') return 'assistant';
  if (role === 'user') return 'user';
  if (role === 'tool' || role === 'toolResult') return toolName ? `tool: ${toolName}` : 'tool output';
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

function maybePrettyJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function looksLikeMarkdown(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return (
    /(^|\n)#{1,6}\s+/.test(trimmed)
    || /(^|\n)-\s+/.test(trimmed)
    || /(^|\n)\d+\.\s+/.test(trimmed)
    || /```[\s\S]*```/.test(trimmed)
    || /\*\*[^*]+\*\*/.test(trimmed)
    || /\[[^\]]+\]\(([^)]+)\)/.test(trimmed)
    || /(^|\n)>\s+/.test(trimmed)
  );
}

function toSafeMarkdownHtml(raw: string): string {
  const renderer = new marked.Renderer();
  renderer.html = () => '';
  renderer.link = ({ href, title, text }) => {
    const url = href || '#';
    const isSafe = /^(https?:|mailto:|\/)/i.test(url);
    const safeHref = isSafe ? url : '#';
    const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
    return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
  };

  return marked.parse(raw, {
    async: false,
    gfm: true,
    breaks: true,
    renderer,
  }) as string;
}

function ExpandableTraceContent({
  content,
  threshold = 500,
  plainClassName,
  jsonClassName,
  markdownClassName,
}: {
  content: string;
  threshold?: number;
  plainClassName: string;
  jsonClassName: string;
  markdownClassName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > threshold;
  const displayContent = isLong && !expanded ? `${content.slice(0, threshold)}...` : content;

  return (
    <div>
      <RenderTraceBody
        raw={displayContent}
        plainClassName={plainClassName}
        jsonClassName={jsonClassName}
        markdownClassName={markdownClassName}
      />
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 flex items-center gap-1 text-[11px] text-mc-accent hover:text-mc-accent/80"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Collapse' : `Show full (${(content.length / 1000).toFixed(1)}k chars)`}
        </button>
      )}
    </div>
  );
}

function RenderTraceBody({
  raw,
  plainClassName,
  jsonClassName,
  markdownClassName,
}: {
  raw: string;
  plainClassName: string;
  jsonClassName: string;
  markdownClassName: string;
}) {
  const json = maybePrettyJson(raw);
  if (json) {
    return <pre className={jsonClassName}>{json}</pre>;
  }

  if (looksLikeMarkdown(raw)) {
    const html = toSafeMarkdownHtml(raw);
    return (
      <div
        className={markdownClassName}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <pre className={plainClassName}>{raw}</pre>;
}

export function TraceViewerModal({ taskId, sessionId, onClose }: TraceViewerModalProps) {
  const [data, setData] = useState<TracePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);

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

    void run();
    return () => {
      isCancelled = true;
    };
  }, [taskId, sessionId]);

  useEffect(() => {
    setQuery('');
    setRoleFilter('all');
    setErrorsOnly(false);
    setCopied(false);
  }, [sessionId]);

  useScrollLock(Boolean(sessionId));

  const summary = data?.summary;
  const previewMessages = useMemo(() => data?.history ?? [], [data]);
  const sessionLabel = data?.session_id || sessionId;
  const roleOptions = useMemo(() => {
    const set = new Set(previewMessages.map((message) => roleLabel(message.role, message.tool_name)));
    return ['all', ...Array.from(set)];
  }, [previewMessages]);
  const filteredMessages = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return previewMessages.filter((message) => {
      const label = roleLabel(message.role, message.tool_name);
      if (roleFilter !== 'all' && label !== roleFilter) return false;
      if (errorsOnly && message.is_error !== true) return false;
      if (!trimmed) return true;
      const content = `${message.content || ''} ${message.tool_name || ''} ${message.tool_result || ''}`.toLowerCase();
      return content.includes(trimmed);
    });
  }, [errorsOnly, previewMessages, query, roleFilter]);
  const errorCount = previewMessages.filter((message) => message.is_error).length;

  async function copySessionId(): Promise<void> {
    if (!sessionLabel) return;
    try {
      await navigator.clipboard.writeText(sessionLabel);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (copyError) {
      console.error('Failed to copy session id:', copyError);
    }
  }

  if (!sessionId) return null;

  return (
    <div
      data-component="src/components/TraceViewerModal"
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-0 sm:p-4 overflow-hidden"
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
              {sessionLabel || 'Loading session ID...'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copySessionId()}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary"
              title="Copy session ID"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy ID'}
            </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-mc-bg-tertiary"
            aria-label="Close trace viewer"
          >
            <X className="w-4 h-4" />
          </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <div className="text-sm text-mc-text-secondary">Loading session timeline...</div>}

          {!loading && error && (
            <div className="p-3 border border-red-400/40 bg-red-500/10 text-sm text-red-400 rounded">
              We could not load this session timeline{taskId ? ` for task \`${taskId}\`` : ''}. {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
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
                <div className="p-2 rounded bg-mc-bg border border-mc-border">
                  <div className="text-mc-text-secondary flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Errors</div>
                  <div className={`font-medium mt-0.5 ${errorCount > 0 ? 'text-red-600' : 'text-mc-text'}`}>{errorCount}</div>
                </div>
              </div>

              {summary?.role_counts && Object.keys(summary.role_counts).length > 0 && (
                <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Role distribution</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(summary.role_counts).map(([role, count]) => (
                      <span key={role} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${roleBadge(role)}`}>
                          {roleIcon(role)}
                          {roleLabel(role)}
                        </span>
                        {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary?.stage_flow && summary.stage_flow.length > 0 && (
                <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Stage flow</div>
                  <div className="text-xs text-mc-text space-y-1.5 flex flex-col items-center text-center">
                    {summary.stage_flow.map((stage, index) => (
                      <div key={`${stage}-${index}`} className="flex flex-col items-center">
                        <span className="px-2 py-1 rounded bg-mc-bg-tertiary border border-mc-border">{stage}</span>
                        {index < summary.stage_flow.length - 1 && (
                          <ArrowDown className="w-3 h-3 text-mc-text-secondary mt-1" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.provenance && data.provenance.length > 0 && (
                <div className="p-3 rounded border border-amber-200 bg-amber-50 space-y-2">
                  <div className="text-xs uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    Message Origin Chain
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
                      Found {data.provenance.length} origin {data.provenance.length === 1 ? 'record' : 'records'} in this session.
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 rounded border border-mc-border bg-mc-bg space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary">Timeline preview ({filteredMessages.length}/{previewMessages.length})</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="inline-flex items-center gap-1 px-2 py-1 rounded border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
                      <input
                        type="checkbox"
                        checked={errorsOnly}
                        onChange={(event) => setErrorsOnly(event.target.checked)}
                      />
                      Errors only
                    </label>
                    <select
                      value={roleFilter}
                      onChange={(event) => setRoleFilter(event.target.value)}
                      className="px-2 py-1 rounded border border-mc-border bg-mc-bg-secondary text-xs text-mc-text"
                    >
                      {roleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? 'All roles' : option}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1 px-2 py-1 rounded border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary min-w-[180px]">
                      <Search className="w-3 h-3" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search messages"
                        className="bg-transparent w-full outline-none text-mc-text placeholder:text-mc-text-secondary"
                      />
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  {filteredMessages.length === 0 && (
                    <div className="p-3 rounded border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
                      No messages match these filters.
                    </div>
                  )}
                  {filteredMessages.map((message, index) => {
                    const isToolOutput = message.role === 'toolResult' || message.role === 'tool';
                    const isError = message.is_error === true;
                    // Visually connect tool results to preceding tool calls with left border
                    const connectorClass = isToolOutput ? 'ml-4 border-l-2 ' + (isError ? 'border-red-300' : 'border-emerald-300') : '';
                    return (
                    <div key={`${message.role}-${index}`} className={`p-2 rounded border border-mc-border bg-mc-bg-secondary ${connectorClass}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${isError ? 'bg-red-100 text-red-700' : roleBadge(message.role)}`}>
                            {roleIcon(message.role)}
                            {roleLabel(message.role, message.tool_name)}
                          </span>
                          {isError && <span className="text-[11px] text-red-600 font-medium">error</span>}
                        </div>
                        <span className="text-[11px] text-mc-text-secondary flex-shrink-0">#{index + 1} - {formatTimestamp(message.timestamp)}</span>
                      </div>
                      {message.content && isToolOutput ? (
                        <ExpandableTraceContent
                          content={message.content}
                          threshold={800}
                          plainClassName={`text-xs p-1.5 mt-1 rounded font-mono whitespace-pre-wrap break-words overflow-x-auto ${isError ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-mc-bg border border-mc-border text-mc-text-secondary'}`}
                          jsonClassName={`text-xs p-1.5 mt-1 rounded font-mono whitespace-pre-wrap break-words overflow-x-auto ${isError ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-mc-bg border border-mc-border text-mc-text-secondary'}`}
                          markdownClassName={`text-xs p-2 mt-1 rounded whitespace-pre-wrap break-words overflow-x-auto [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[11px] [&_pre]:font-mono [&_a]:text-cyan-700 [&_a]:underline ${isError ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-mc-bg border border-mc-border text-mc-text'}`}
                        />
                      ) : message.content ? (
                        <RenderTraceBody
                          raw={message.content}
                          plainClassName="text-xs text-mc-text whitespace-pre-wrap break-words"
                          jsonClassName="text-xs p-1.5 mt-1 rounded font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-48 bg-mc-bg border border-mc-border text-mc-text-secondary"
                          markdownClassName="text-xs text-mc-text whitespace-pre-wrap break-words [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[11px] [&_pre]:font-mono [&_a]:text-cyan-700 [&_a]:underline"
                        />
                      ) : null}
                      {message.tool_calls && message.tool_calls.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {message.tool_calls.map((tc, tcIdx) => (
                            <div key={`tc-${tcIdx}`} className="flex items-start gap-1.5 text-xs">
                              <Wrench className="w-3 h-3 mt-0.5 text-mc-text-secondary flex-shrink-0" />
                              <div className="min-w-0">
                                <span className="font-mono font-medium text-mc-accent">{tc.name}</span>
                                {tc.input && (
                                  <ExpandableTraceContent
                                    content={tc.input}
                                    plainClassName="mt-0.5 p-1.5 rounded bg-mc-bg border border-mc-border text-[11px] text-mc-text-secondary overflow-x-auto whitespace-pre-wrap break-words font-mono"
                                    jsonClassName="mt-0.5 p-1.5 rounded bg-mc-bg border border-mc-border text-[11px] text-mc-text-secondary overflow-x-auto whitespace-pre-wrap break-words font-mono"
                                    markdownClassName="mt-0.5 p-1.5 rounded bg-mc-bg border border-mc-border text-[11px] text-mc-text overflow-x-auto whitespace-pre-wrap break-words [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[10px] [&_a]:text-cyan-700 [&_a]:underline"
                                  />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {message.tool_result && (
                        <div className="mt-1 flex items-start gap-1.5 text-xs">
                          <Terminal className="w-3 h-3 mt-0.5 text-emerald-600 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <ExpandableTraceContent
                              content={message.tool_result}
                              plainClassName="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 overflow-x-auto whitespace-pre-wrap break-words font-mono"
                              jsonClassName="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 overflow-x-auto whitespace-pre-wrap break-words font-mono"
                              markdownClassName="p-1.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 overflow-x-auto whitespace-pre-wrap break-words [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:font-mono [&_code]:text-[10px] [&_a]:text-emerald-700 [&_a]:underline"
                            />
                          </div>
                        </div>
                      )}
                      {!message.content && !message.tool_calls?.length && !message.tool_result && (
                        <p className="text-xs text-mc-text-secondary italic">(empty message)</p>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
              <details className="p-3 rounded border border-mc-border bg-mc-bg">
                <summary className="cursor-pointer text-sm text-mc-text">Debug details</summary>
                <div className="mt-2 space-y-2 text-xs">
                  <div className="text-mc-text-secondary">Session key: <span className="font-mono">{data.session_key || 'Not available'}</span></div>
                  {data.session && (
                    <div className="text-mc-text-secondary break-words">
                      Session row: <span className="font-mono">{data.session.id}</span>
                      {' '}({data.session.status || 'unknown'} / {data.session.session_type || 'unknown'} / {data.session.channel || 'unknown'})
                    </div>
                  )}
                  {data.invocation?.output_directory && (
                    <div className="text-mc-text-secondary break-all">Artifacts: <span className="font-mono">{data.invocation.output_directory}</span></div>
                  )}
                  <pre className="p-2 rounded bg-mc-bg-secondary border border-mc-border overflow-x-auto text-[11px] text-mc-text-secondary whitespace-pre-wrap break-words">
                    {JSON.stringify({ summary: data.summary, invocation: data.invocation, session: data.session, diagnostics: data.diagnostics }, null, 2)}
                  </pre>
                </div>
              </details>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
