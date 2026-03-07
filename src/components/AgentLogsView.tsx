'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  MessageSquare,
  RefreshCw,
  Filter,
  X,
  ChevronDown,
  Search,
  Calendar,
  Bot,
  User,
  Cpu,
  ChevronUp,
} from 'lucide-react';
import type { AgentLog } from '@/lib/types';
import { AgentInitials } from './AgentInitials';

interface AgentLogsViewProps {
  workspaceId: string;
}

type RoleFilter = 'all' | 'user' | 'assistant' | 'system';

interface AgentOption {
  id: string;
  name: string;
  role: string;
  status: string;
}

interface SessionOption {
  openclaw_session_id: string;
  agent_name: string;
  log_count: number;
  first_log_at: string;
  last_log_at: string;
}

interface LogsResponse {
  logs: AgentLog[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function AgentLogsView({ workspaceId }: AgentLogsViewProps) {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sessionFilter, setSessionFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Filter options
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Check if any filter is active
  const hasActiveFilters =
    agentFilter !== '' ||
    roleFilter !== 'all' ||
    sessionFilter !== '' ||
    debouncedSearch !== '' ||
    dateFrom !== '' ||
    dateTo !== '';

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Fetch agents for filter dropdown
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch(`/api/agents?workspace_id=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          setAgents(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }
    };

    fetchAgents();
  }, [workspaceId]);

  // Fetch sessions for filter dropdown
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch(`/api/logs/sessions?workspace_id=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          setSessions(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
      }
    };

    fetchSessions();
  }, [workspaceId]);

  // Fetch logs
  const fetchLogs = useCallback(
    async (offset = 0, append = false, silent = false) => {
      try {
        if (!append && !silent) setLoading(true);
        else if (append) setLoadingMore(true);
        setError(null);

        const params = new URLSearchParams({
          workspace_id: workspaceId,
          limit: '50',
          offset: offset.toString(),
          order: 'desc',
        });

        if (agentFilter) params.set('agent_id', agentFilter);
        if (roleFilter !== 'all') params.set('role', roleFilter);
        if (sessionFilter) params.set('session_id', sessionFilter);
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (dateFrom) params.set('from', dateFrom);
        if (dateTo) params.set('to', dateTo);

        const res = await fetch(`/api/logs?${params.toString()}`);

        if (res.ok) {
          const data: LogsResponse = await res.json();
          if (append) {
            setLogs((prev) => [...prev, ...data.logs]);
          } else {
            setLogs(data.logs);
          }
          setTotal(data.total);
          setHasMore(data.hasMore);
        } else if (!silent) {
          const errData = await res.json().catch(() => ({ error: 'Failed to fetch logs' }));
          setError(errData.error || 'Failed to fetch logs');
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Failed to fetch logs');
        }
      } finally {
        if (!silent) setLoading(false);
        setLoadingMore(false);
      }
    },
    [workspaceId, agentFilter, roleFilter, sessionFilter, debouncedSearch, dateFrom, dateTo]
  );

  // Initial fetch and refetch on filter changes
  useEffect(() => {
    fetchLogs(0, false);
  }, [fetchLogs]);

  // Silent polling for new logs
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (!loading && !loadingMore) {
        fetchLogs(0, false, true);
      }
    }, 10000);

    pollingRef.current = pollInterval;

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchLogs, loading, loadingMore]);

  // Load more handler
  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchLogs(logs.length, true);
    }
  };

  // Clear all filters
  const handleClearFilters = () => {
    setAgentFilter('');
    setRoleFilter('all');
    setSessionFilter('');
    setSearchQuery('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
  };

  // Get role badge styling
  const getRoleBadge = (role: string) => {
    const base = 'px-2 py-0.5 rounded text-xs font-medium';
    switch (role) {
      case 'user':
        return `${base} bg-blue-100 text-blue-700`;
      case 'assistant':
        return `${base} bg-amber-100 text-amber-700`;
      case 'system':
        return `${base} bg-slate-100 text-slate-600`;
      default:
        return `${base} bg-mc-bg-tertiary text-mc-text-secondary`;
    }
  };

  // Get role icon
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'user':
        return <User className="w-3 h-3" />;
      case 'assistant':
        return <Bot className="w-3 h-3" />;
      case 'system':
        return <Cpu className="w-3 h-3" />;
      default:
        return null;
    }
  };

  return (
    <div
      data-component="src/components/AgentLogsView"
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Toolbar */}
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-mc-accent" />
          <span className="font-mono font-medium">Agent Logs</span>
          <span className="text-xs text-mc-text-secondary hidden sm:inline">
            {total > 0 ? `${total} total` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 min-h-11 border rounded text-sm transition-colors ${
              showFilters || hasActiveFilters
                ? 'border-mc-accent bg-mc-accent/10 text-mc-accent'
                : 'border-mc-border hover:bg-mc-bg-tertiary'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {hasActiveFilters && (
              <span className="w-5 h-5 rounded-full bg-mc-accent text-white text-xs flex items-center justify-center">
                !
              </span>
            )}
            {showFilters ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => fetchLogs(0, false)}
            disabled={loading}
            className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Filters Panel */}
      {showFilters && (
        <div className="p-3 border-b border-mc-border bg-mc-bg space-y-3">
          {/* First row: Agent, Session, Role */}
          <div className="flex flex-wrap gap-2">
            {/* Agent Filter */}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                Agent
              </label>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-full min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">All Agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Session Filter */}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                Session
              </label>
              <select
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                className="w-full min-h-11 px-2 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">All Sessions</option>
                {sessions.map((session) => (
                  <option key={session.openclaw_session_id} value={session.openclaw_session_id}>
                    {session.agent_name} ({session.log_count} logs)
                  </option>
                ))}
              </select>
            </div>

            {/* Role Filter Tabs */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                Role
              </label>
              <div className="flex border border-mc-border rounded overflow-hidden min-h-11">
                {(['all', 'user', 'assistant', 'system'] as RoleFilter[]).map((role) => (
                  <button
                    key={role}
                    onClick={() => setRoleFilter(role)}
                    className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                      roleFilter === role
                        ? 'bg-mc-accent text-white'
                        : 'bg-mc-bg hover:bg-mc-bg-tertiary'
                    }`}
                  >
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Second row: Search, Date Range */}
          <div className="flex flex-wrap gap-2">
            {/* Search Input */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search logs..."
                  className="w-full min-h-11 pl-9 pr-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>

            {/* Date From */}
            <div className="min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                From
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full min-h-11 pl-9 pr-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>

            {/* Date To */}
            <div className="min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">
                To
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full min-h-11 pl-9 pr-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <div className="flex items-end">
                <button
                  onClick={handleClearFilters}
                  className="flex items-center gap-1.5 px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary transition-colors text-mc-text-secondary"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pagination Info */}
      {total > 0 && (
        <div className="px-3 py-2 border-b border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
          Showing {logs.length} of {total} logs
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-accent-red/20 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-mc-accent-red" />
            </div>
            <p className="text-sm text-mc-accent-red">{error}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Logs Found</h3>
            <p className="text-sm text-mc-text-secondary">
              {hasActiveFilters
                ? 'No logs match your current filters.'
                : 'No agent logs have been recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 hover:border-mc-accent/40 transition-colors"
              >
                <div className="flex gap-3">
                  {/* Agent Avatar */}
                  <div className="flex-shrink-0 mt-1">
                    {log.agent_name ? (
                      <AgentInitials name={log.agent_name} size="sm" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                        <Cpu className="w-3 h-3 text-mc-text-secondary" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`flex items-center gap-1 ${getRoleBadge(log.role)}`}>
                        {getRoleIcon(log.role)}
                        {log.role}
                      </span>
                      {log.agent_name && (
                        <span className="text-xs text-mc-text-secondary">{log.agent_name}</span>
                      )}
                      <span className="text-xs text-mc-text-secondary ml-auto">
                        {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Log Content - Monospace */}
                    <div className="text-sm text-mc-text font-mono whitespace-pre-wrap break-words bg-mc-bg-tertiary rounded p-2 max-h-64 overflow-y-auto">
                      {log.content}
                    </div>

                    {/* Session ID */}
                    <div className="mt-2 text-xs text-mc-text-secondary">
                      Session: <span className="font-mono">{log.openclaw_session_id}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-4 py-2 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
