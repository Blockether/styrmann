'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Calendar, ChevronDown, ChevronUp, Filter, RefreshCw, Search, Server } from 'lucide-react';
import { OPENCLAW_TIMEZONE, formatOpenClawDateTime } from '@/lib/openclaw-time';

type LogLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

interface GatewayLogEntry {
  id: string;
  timestamp: string;
  unit: string;
  level: Exclude<LogLevelFilter, 'all'>;
  message: string;
}

interface GatewayLogsResponse {
  source: string;
  unit: string;
  total: number;
  limit: number;
  entries: GatewayLogEntry[];
}

export function GatewayLogsView() {
  const [logs, setLogs] = useState<GatewayLogEntry[]>([]);
  const [source, setSource] = useState('unknown');
  const [total, setTotal] = useState(0);
  const [unit, setUnit] = useState('openclaw-gateway');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const hasActiveFilters = levelFilter !== 'all' || debouncedSearch !== '' || dateFrom !== '' || dateTo !== '';

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ limit: '2000' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (levelFilter !== 'all') params.set('level', levelFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const res = await fetch(`/api/openclaw/gateway-logs?${params.toString()}`);

      if (res.ok) {
        const data: GatewayLogsResponse = await res.json();
        setLogs(Array.isArray(data.entries) ? data.entries : []);
        setSource(data.source || 'unknown');
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setUnit(data.unit || 'openclaw-gateway');
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to fetch gateway logs' }));
        setError(errData.error || 'Failed to fetch gateway logs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch gateway logs');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, levelFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);


  const clearFilters = () => {
    setLevelFilter('all');
    setSearchQuery('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const levelTone = (level: GatewayLogEntry['level']) => {
    const base = 'px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide';
    if (level === 'error') return `${base} bg-red-100 text-red-700`;
    if (level === 'warn') return `${base} bg-amber-100 text-amber-700`;
    if (level === 'debug') return `${base} bg-slate-200 text-slate-700`;
    return `${base} bg-blue-100 text-blue-700`;
  };

  const relativeTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return formatDistanceToNow(parsed, { addSuffix: true });
  };

  const absoluteTime = (value: string) => {
    return formatOpenClawDateTime(value);
  };

  return (
    <div data-component="src/components/GatewayLogsView" className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-mc-text">OpenClaw Gateway Runtime Logs</p>
          <p className="text-xs text-mc-text-secondary">
            Source: <span className="font-mono">{source}</span> · Unit: <span className="font-mono">{unit}</span> · Timezone: <span className="font-mono">{OPENCLAW_TIMEZONE}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className={`flex items-center gap-2 px-3 min-h-11 border rounded text-sm transition-colors ${
              showFilters || hasActiveFilters
                ? 'border-mc-accent bg-mc-accent/10 text-mc-accent'
                : 'border-mc-border hover:bg-mc-bg-tertiary'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {hasActiveFilters && (
              <span className="w-5 h-5 rounded-full bg-mc-accent text-white text-xs flex items-center justify-center">!</span>
            )}
            {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Loading...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="p-3 border-b border-mc-border bg-mc-bg space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">Severity</label>
              <div className="flex border border-mc-border rounded overflow-hidden min-h-11">
                {(['all', 'error', 'warn', 'info', 'debug'] as LogLevelFilter[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setLevelFilter(level)}
                    className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                      levelFilter === level ? 'bg-mc-accent text-white' : 'bg-mc-bg hover:bg-mc-bg-tertiary'
                    }`}
                  >
                    {level.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search gateway logs..."
                  className="w-full min-h-11 pl-9 pr-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">From</label>
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

            <div className="min-w-[140px]">
              <label className="block text-xs text-mc-text-secondary mb-1 hidden sm:block">To</label>
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

            {hasActiveFilters && (
              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  className="px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary transition-colors text-mc-text-secondary"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="px-3 py-2 border-b border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
          Showing {logs.length} of {total} logs
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-accent-red/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-mc-accent-red" />
            </div>
            <p className="text-sm text-mc-accent-red">{error}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <Server className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Gateway Logs Found</h3>
            <p className="text-sm text-mc-text-secondary">
              {hasActiveFilters
                ? 'No gateway log entries match your current filters.'
                : 'No OpenClaw gateway log entries were returned.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((entry) => (
              <div key={entry.id} className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 hover:border-mc-accent/40 transition-colors">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={levelTone(entry.level)}>{entry.level}</span>
                  <span className="text-xs text-mc-text-secondary font-mono">{entry.unit}</span>
                  <span className="text-xs text-mc-text-secondary ml-auto" title={absoluteTime(entry.timestamp)}>
                    {relativeTime(entry.timestamp)}
                  </span>
                </div>
                <div className="text-sm text-mc-text font-mono whitespace-pre-wrap break-words bg-mc-bg-tertiary rounded p-2 max-h-64 overflow-y-auto">
                  {entry.message}
                </div>
                <div className="mt-2 text-xs text-mc-text-secondary">
                  At <span className="font-mono">{absoluteTime(entry.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
