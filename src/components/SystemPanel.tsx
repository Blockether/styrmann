'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  RefreshCw,
  Cpu,
  Activity,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  HardDrive,
  Wrench,
} from 'lucide-react';
import type {
  SystemInfo,
  DaemonStatsSnapshot,
  ValidationResult,
  ValidationCheck,
  DaemonModuleInfo,
  DaemonJobInfo,
} from '@/lib/types';

interface DaemonStatsResponse {
  snapshot: DaemonStatsSnapshot | null;
  stale: boolean;
  stale_seconds: number;
}

interface SystemPanelProps {
  embedded?: boolean;
}

export function SystemPanel({ embedded = false }: SystemPanelProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [daemonStats, setDaemonStats] = useState<DaemonStatsResponse | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairingChecks, setRepairingChecks] = useState<Set<string>>(new Set());
  const [repairResults, setRepairResults] = useState<Record<string, { success: boolean; agent_name?: string; error?: string }>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [infoRes, daemonRes] = await Promise.all([
        fetch('/api/system/info'),
        fetch('/api/daemon/stats'),
      ]);

      if (infoRes.ok) {
        const infoData = await infoRes.json();
        setSystemInfo(infoData);
      }

      if (daemonRes.ok) {
        const daemonData = await daemonRes.json();
        setDaemonStats(daemonData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system data');
    } finally {
      setLoading(false);
    }
  }, []);

  const runValidation = async () => {
    setValidating(true);
    try {
      const res = await fetch('/api/system/validate', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setValidationResult(data);
      }
    } catch (err) {
      console.error('Validation failed:', err);
    } finally {
      setValidating(false);
    }
  };

  const triggerRepair = async (checkItem: ValidationCheck) => {
    setRepairingChecks(prev => new Set(prev).add(checkItem.name));
    try {
      const res = await fetch('/api/system/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_name: checkItem.name,
          repair_prompt: checkItem.repair_prompt,
        }),
      });
      const data = await res.json();
      setRepairResults(prev => ({ ...prev, [checkItem.name]: data }));
    } catch {
      setRepairResults(prev => ({ ...prev, [checkItem.name]: { success: false, error: 'Request failed' } }));
    } finally {
      setRepairingChecks(prev => {
        const s = new Set(prev);
        s.delete(checkItem.name);
        return s;
      });
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const getStatusIcon = (status: 'pass' | 'fail' | 'warn') => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'fail':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warn':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  const formatModuleLastTick = (mod: DaemonModuleInfo, snapshot: DaemonStatsSnapshot) => {
    if (mod.interval_ms === 0) {
      return mod.last_tick ? formatDistanceToNow(new Date(mod.last_tick), { addSuffix: true }) : 'Streaming';
    }
    if (!mod.last_tick) {
      return snapshot.uptime_seconds < Math.max(30, Math.round(mod.interval_ms / 1000) + 5)
        ? 'Waiting first tick'
        : 'No tick recorded';
    }
    try {
      return formatDistanceToNow(new Date(mod.last_tick), { addSuffix: true });
    } catch {
      return 'Invalid date';
    }
  };

  const formatRelativeTime = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return 'Invalid date';
    }
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const toolbarInnerClass = embedded
    ? 'p-3 flex items-center justify-between gap-2 flex-wrap'
    : 'max-w-7xl mx-auto p-3 flex items-center justify-between gap-2 flex-wrap';

  const contentClass = embedded
    ? 'px-4 sm:px-6 py-6'
    : 'max-w-7xl mx-auto px-4 sm:px-6 py-6';

  return (
    <div data-component="src/components/SystemPanel" className={embedded ? undefined : 'min-h-screen'}>
      {/* Toolbar */}
      <div className="border-b border-mc-border bg-mc-bg-secondary">
        <div className={toolbarInnerClass}>
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-4 h-4 text-mc-text-secondary" />
            <h2 className="text-sm font-medium text-mc-text truncate">System Runtime</h2>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={contentClass}>
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Card 1: Process Info */}
          <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
              <Server className="w-4 h-4 text-mc-text-secondary" />
              <h3 className="text-sm font-medium">Process Info</h3>
            </div>
            <div className="p-4 space-y-4">
              {systemInfo ? (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-mc-text-secondary">Node.js</span>
                      <p className="font-mono">{systemInfo.node_version}</p>
                    </div>
                    <div>
                      <span className="text-mc-text-secondary">Platform</span>
                      <p className="font-mono">{systemInfo.platform} / {systemInfo.arch}</p>
                    </div>
                    <div>
                      <span className="text-mc-text-secondary">Hostname</span>
                      <p className="font-mono">{systemInfo.hostname}</p>
                    </div>
                    <div>
                      <span className="text-mc-text-secondary">Uptime</span>
                      <p>{formatUptime(systemInfo.uptime_seconds)}</p>
                    </div>
                  </div>

                  <div className="border-t border-mc-border pt-4">
                    <div className="text-sm text-mc-text-secondary mb-2">Web Process Memory</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-mc-text-secondary">RSS:</span>{' '}
                        <span className="font-mono">{systemInfo.memory.rss_mb.toFixed(1)} MB</span>
                      </div>
                      <div>
                        <span className="text-mc-text-secondary">Heap:</span>{' '}
                        <span className="font-mono">{systemInfo.memory.heap_used_mb.toFixed(1)} / {systemInfo.memory.heap_total_mb.toFixed(1)} MB</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-mc-border pt-4">
                    <div className="text-sm text-mc-text-secondary mb-2">System Memory</div>
                    <div className="text-sm mb-2">
                      <span className="font-mono">{(systemInfo.system_memory.total_mb - systemInfo.system_memory.free_mb).toFixed(1)} MB</span>
                      {' / '}
                      <span className="font-mono">{systemInfo.system_memory.total_mb.toFixed(1)} MB</span>
                      {' ('}
                      <span className="font-mono">{systemInfo.system_memory.used_percent.toFixed(1)}%</span>
                      {')'}
                    </div>
                    <div className="w-full h-2 bg-mc-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-mc-accent transition-all"
                        style={{ width: `${Math.min(systemInfo.system_memory.used_percent, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="border-t border-mc-border pt-4">
                    <div className="text-sm text-mc-text-secondary mb-2">Services</div>
                    <div className="flex gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            systemInfo.services.web === 'active' ? 'bg-green-500' : 'bg-red-500'
                          }`}
                          title={systemInfo.services.web}
                        />
                        <span>Web</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            systemInfo.services.daemon === 'active' ? 'bg-green-500' : 'bg-red-500'
                          }`}
                          title={systemInfo.services.daemon}
                        />
                        <span>Daemon</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-mc-text-secondary" />
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Daemon Status */}
          <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
              <Cpu className="w-4 h-4 text-mc-text-secondary" />
              <h3 className="text-sm font-medium">Daemon Status</h3>
            </div>
            <div className="p-4 space-y-4">
              {daemonStats ? (
                daemonStats.snapshot ? (
                  <>
                    {daemonStats.stale && (
                      <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Stale ({daemonStats.stale_seconds}s since last update)</span>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-mc-text-secondary">PID</span>
                        <p className="font-mono">{daemonStats.snapshot.pid}</p>
                      </div>
                      <div>
                        <span className="text-mc-text-secondary">Uptime</span>
                        <p>{formatUptime(daemonStats.snapshot.uptime_seconds)}</p>
                      </div>
                      <div>
                        <span className="text-mc-text-secondary">Memory</span>
                        <p className="font-mono">{daemonStats.snapshot.memory_mb.toFixed(1)} MB</p>
                      </div>
                    </div>

                    <div className="border-t border-mc-border pt-4">
                      <div className="text-sm text-mc-text-secondary mb-2">Modules</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-mc-text-secondary">
                              <th className="pb-2">Name</th>
                              <th className="pb-2">Interval</th>
                              <th className="pb-2">Last Tick</th>
                            </tr>
                          </thead>
                          <tbody>
                            {daemonStats.snapshot.modules.map((mod: DaemonModuleInfo) => (
                              <tr key={mod.name} className="border-t border-mc-border">
                                <td className="py-2 font-mono">{mod.name}</td>
                                <td className="py-2">{mod.interval_ms === 0 ? 'continuous' : `${mod.interval_ms}ms`}</td>
                                <td className="py-2">{formatModuleLastTick(mod, daemonStats.snapshot!)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="border-t border-mc-border pt-4">
                      <div className="text-sm text-mc-text-secondary mb-2">Counters</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-mc-text-secondary">Dispatched:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.dispatched_count}</span>
                        </div>
                        <div>
                          <span className="text-mc-text-secondary">Heartbeats:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.heartbeat_count}</span>
                        </div>
                        <div>
                          <span className="text-mc-text-secondary">Recovered:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.stale_recovered_count}</span>
                        </div>
                        <div>
                          <span className="text-mc-text-secondary">Events:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.routed_event_count}</span>
                        </div>
                        <div>
                          <span className="text-mc-text-secondary">Logs Stored:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.log_entries_stored}</span>
                        </div>
                        <div>
                          <span className="text-mc-text-secondary">Logs Cleaned:</span>{' '}
                          <span className="font-mono">{daemonStats.snapshot.log_entries_cleaned}</span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-8 text-mc-text-secondary">
                    <Clock className="w-5 h-5 mr-2" />
                    <span>Waiting for daemon...</span>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-mc-text-secondary" />
                </div>
              )}
            </div>
          </div>

          {/* Card 3: Scheduled Jobs */}
          <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
              <Clock className="w-4 h-4 text-mc-text-secondary" />
              <h3 className="text-sm font-medium">Scheduled Jobs</h3>
            </div>
            <div className="p-4">
              {daemonStats?.snapshot?.jobs ? (
                daemonStats.snapshot.jobs.length > 0 ? (
                  <div className="space-y-3">
                    {daemonStats.snapshot.jobs.map((job: DaemonJobInfo) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between p-3 bg-mc-bg-secondary rounded border border-mc-border"
                      >
                        <div>
                          <div className="font-medium text-sm">{job.name}</div>
                          <div className="text-xs text-mc-text-secondary font-mono">{job.cron}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-mc-text-secondary">
                            Last: {formatRelativeTime(job.last_run)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              job.enabled
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {job.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-mc-text-secondary">
                    No scheduled jobs registered
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-mc-text-secondary" />
                </div>
              )}
            </div>
          </div>

          {/* Card 4: Config Validation */}
          <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-mc-text-secondary" />
              <h3 className="text-sm font-medium">Config Validation</h3>
            </div>
            <div className="p-4 space-y-4">
              <button
                onClick={runValidation}
                disabled={validating}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50 transition-colors"
              >
                {validating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Validating...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-5 h-5" />
                    <span>Run Validation</span>
                  </>
                )}
              </button>

              {validationResult && (
                <>
                  <div className="border-t border-mc-border pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      {validationResult.passed ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                      <span className="font-medium">
                        {validationResult.passed ? 'All checks passed' : 'Some checks failed'}
                      </span>
                    </div>
                    <p className="text-sm text-mc-text-secondary mb-2">
                      {validationResult.checks?.filter((c: ValidationCheck) => c.status === 'pass').length ?? 0} passed,{' '}
                      {validationResult.errors} failed, {validationResult.warnings} warnings
                    </p>
                    <p className="text-xs text-mc-text-secondary">
                      Last run: {format(new Date(validationResult.ran_at), 'PPpp')}
                    </p>
                  </div>

                  <div className="border-t border-mc-border pt-4 space-y-4">
                    {(() => {
                      const systemChecks = validationResult.checks.filter(c => c.category !== 'agent');
                      const agentChecks = validationResult.checks.filter(c => c.category === 'agent');

                      const renderCheckItem = (check: ValidationCheck) => {
                        const isRepairing = repairingChecks.has(check.name);
                        const repairResult = repairResults[check.name];
                        const canRepair = check.repairable && check.status !== 'pass';

                        return (
                          <div
                            key={check.name}
                            className="flex items-start gap-2 p-2 bg-mc-bg-secondary rounded border border-mc-border"
                          >
                            {getStatusIcon(check.status)}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{check.name}</div>
                              <div className="text-xs text-mc-text-secondary">{check.message}</div>
                              {check.details && (
                                <div className="text-xs text-mc-text-secondary mt-1 font-mono bg-mc-bg-tertiary p-1 rounded">
                                  {check.details}
                                </div>
                              )}
                              {repairResult && (
                                <div className={`text-xs mt-1 ${repairResult.success ? 'text-green-600' : 'text-red-600'}`}>
                                  {repairResult.success
                                    ? `Dispatched to ${repairResult.agent_name ?? 'agent'}`
                                    : repairResult.error ?? 'Repair failed'
                                  }
                                </div>
                              )}
                            </div>
                            {canRepair && (
                              <button
                                onClick={() => triggerRepair(check)}
                                disabled={isRepairing}
                                className="flex items-center justify-center gap-1 px-2 min-h-11 border border-mc-border rounded text-xs hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
                                title="Repair"
                              >
                                {isRepairing ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Wrench className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      };

                      return (
                        <>
                          {systemChecks.length > 0 && (
                            <div>
                              <h4 className="text-xs font-medium text-mc-text-secondary uppercase tracking-wide mb-2">System Checks</h4>
                              <div className="space-y-2">
                                {systemChecks.map(renderCheckItem)}
                              </div>
                            </div>
                          )}
                          {agentChecks.length > 0 && (
                            <div>
                              <h4 className="text-xs font-medium text-mc-text-secondary uppercase tracking-wide mb-2">Agent Health</h4>
                              <div className="space-y-2">
                                {agentChecks.map(renderCheckItem)}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}

              {!validationResult && !validating && (
                <div className="text-center py-4 text-sm text-mc-text-secondary">
                  Click &quot;Run Validation&quot; to check system configuration
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
