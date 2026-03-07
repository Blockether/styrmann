'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Cpu,
  Wifi,
  WifiOff,
  Bot,
  Star,
  AlertCircle,
  Power,
  Save,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ScrollText,
  Package,
  Settings,
} from 'lucide-react';
import { AgentModal } from './AgentModal';
import type { Agent, AgentTask } from '@/lib/types';

interface OpenClawSession {
  id: string;
  channel: string;
  peer?: string;
  model?: string;
  status: string;
}

interface OpenClawStatus {
  connected: boolean;
  sessions_count: number;
  sessions: OpenClawSession[];
  gateway_url: string;
  error?: string;
}

interface OpenClawModels {
  defaultModel?: string;
  availableModels: string[];
  source: string;
  error?: string;
}

export function OpenClawPanel() {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [models, setModels] = useState<OpenClawModels | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [savingModel, setSavingModel] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [modelSaveStatus, setModelSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, modelsRes, agentsRes] = await Promise.all([
        fetch('/api/openclaw/status'),
        fetch('/api/openclaw/models'),
        fetch('/api/agents'),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }

      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setModels(modelsData);
        if (modelsData.defaultModel) setSelectedModel(modelsData.defaultModel);
      }

      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(Array.isArray(agentsData) ? agentsData : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch OpenClaw data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const maskToken = (url: string) => {
    return url.replace(/token=[^&]+/gi, 'token=***');
  };

  const agentCounts = {
    working: agents.filter((a) => a.status === 'working').length,
    standby: agents.filter((a) => a.status === 'standby').length,
    offline: agents.filter((a) => a.status === 'offline').length,
    total: agents.length,
  };

  const occupationBarWidths = {
    working: agentCounts.total > 0 ? (agentCounts.working / agentCounts.total) * 100 : 0,
    standby: agentCounts.total > 0 ? (agentCounts.standby / agentCounts.total) * 100 : 0,
    offline: agentCounts.total > 0 ? (agentCounts.offline / agentCounts.total) * 100 : 0,
  };

  return (
    <div data-component="src/components/OpenClawPanel" className="min-h-screen">
      {/* Toolbar */}
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-mc-accent" />
          <span className="font-mono font-medium">OpenClaw Gateway</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setRestarting(true);
              setRestartResult(null);
              try {
                const res = await fetch('/api/system/restart-gateway', { method: 'POST' });
                const data = await res.json();
                setRestartResult(data);
                if (data.success) setTimeout(() => { setRestartResult(null); fetchData(); }, 3000);
              } catch {
                setRestartResult({ success: false, error: 'Request failed' });
              } finally {
                setRestarting(false);
              }
            }}
            disabled={restarting}
            className="flex items-center gap-2 px-3 min-h-11 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <Power className={`w-4 h-4 ${restarting ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{restarting ? 'Restarting...' : 'Restart Gateway'}</span>
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {restartResult && (
          <div className={`mb-4 p-4 rounded-lg text-sm ${restartResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {restartResult.success ? 'Gateway restarted successfully. Reconnecting...' : `Restart failed: ${restartResult.error}`}
          </div>
        )}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Card 1: Gateway Status (Full Width) */}
          <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
            <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
              <Wifi className="w-4 h-4 text-mc-text-secondary" />
              <h3 className="text-sm font-medium">Gateway Status</h3>
            </div>
            <div className="p-4">
              {status ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    {status.connected ? (
                      <>
                        <span className="inline-block w-4 h-4 rounded-full bg-green-500" />
                        <Wifi className="w-5 h-5 text-green-500" />
                        <span className="text-lg font-medium text-green-600">Connected</span>
                      </>
                    ) : (
                      <>
                        <span className="inline-block w-4 h-4 rounded-full bg-red-500" />
                        <WifiOff className="w-5 h-5 text-red-500" />
                        <span className="text-lg font-medium text-red-600">Disconnected</span>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="text-sm text-mc-text-secondary mb-1">Gateway URL</div>
                    <code className="text-sm bg-mc-bg-tertiary px-2 py-1 rounded font-mono">
                      {maskToken(status.gateway_url)}
                    </code>
                  </div>

                  <div>
                    <div className="text-sm text-mc-text-secondary mb-1">Active Sessions</div>
                    <span className="text-2xl font-mono font-medium">{status.sessions_count}</span>
                  </div>

                  {status.error && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">Error</div>
                        <div>{status.error}</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-mc-text-secondary" />
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Agent Occupation + Models */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Card 2: Agent Occupation */}
            <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
              <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-mc-text-secondary" />
                  <h3 className="text-sm font-medium">Agent Occupation</h3>
                </div>
                <div className="flex gap-3 text-xs text-mc-text-secondary">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />{agentCounts.working} working</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />{agentCounts.standby} standby</span>
                  {agentCounts.offline > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-400" />{agentCounts.offline} offline</span>}
                </div>
              </div>
              <div>
                {agents.length > 0 ? (
                  <div className="divide-y divide-mc-border">
                    {agents.map((agent) => {
                      const isWorking = agent.status === 'working';
                      const isOffline = agent.status === 'offline';
                      const taskCount = agent.active_task_count ?? 0;
                      const isExpanded = expandedAgents.has(agent.id);
                      const tasks = agent.active_tasks ?? [];

                      return (
                        <div key={agent.id} className={isOffline ? 'opacity-50' : ''}>
                          {/* Agent row — always visible */}
                          <button
                            onClick={() => {
                              setExpandedAgents(prev => {
                                const next = new Set(prev);
                                if (next.has(agent.id)) next.delete(agent.id);
                                else next.add(agent.id);
                                return next;
                              });
                            }}
                            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-mc-bg-tertiary/30 transition-colors"
                          >
                            {/* Status dot */}
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                              isWorking ? 'bg-green-500 ring-2 ring-green-500/30 ring-offset-1' :
                              agent.status === 'standby' ? 'bg-blue-500' : 'bg-gray-400'
                            }`} />

                            {/* Name */}
                            <span className="font-medium text-sm truncate flex-1 min-w-0">{agent.name}</span>

                            {/* Task count badge */}
                            {taskCount > 0 && (
                              <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                                isWorking ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {taskCount} task{taskCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {taskCount === 0 && (
                              <span className="text-xs text-mc-text-secondary">No tasks</span>
                            )}

                            {/* Edit button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingAgent(agent);
                              }}
                              className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors flex-shrink-0"
                              title={`Edit ${agent.name}`}
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </button>

                            {/* Expand chevron */}
                            {taskCount > 0 ? (
                              isExpanded ? <ChevronDown className="w-4 h-4 text-mc-text-secondary flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-mc-text-secondary flex-shrink-0" />
                            ) : (
                              <span className="w-4" />
                            )}
                          </button>

                          {/* Expanded task list */}
                          {isExpanded && tasks.length > 0 && (
                            <div className="border-t border-mc-border/50 bg-mc-bg-tertiary/20">
                              {tasks.map((task) => {
                                const statusColors: Record<string, string> = {
                                  in_progress: 'bg-mc-accent text-white',
                                  assigned: 'bg-mc-accent-yellow text-white',
                                  testing: 'bg-mc-accent-cyan text-white',
                                  review: 'bg-mc-accent-purple text-white',
                                  verification: 'bg-orange-500 text-white',
                                };
                                const statusLabels: Record<string, string> = {
                                  in_progress: 'In Progress',
                                  assigned: 'Assigned',
                                  testing: 'Testing',
                                  review: 'Review',
                                  verification: 'Verification',
                                };

                                return (
                                  <div key={task.id} className="px-4 py-2.5 pl-10 flex items-center gap-3 border-b border-mc-border/30 last:border-b-0">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-0.5">
                                        <span className="text-sm font-medium truncate">{task.title}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${statusColors[task.status] || 'bg-gray-200 text-gray-600'}`}>
                                          {statusLabels[task.status] || task.status}
                                        </span>
                                      </div>
                                      <span className="text-xs text-mc-text-secondary">{task.workspace_name || task.workspace_slug}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <a
                                        href={`/workspace/${task.workspace_slug}?view=logs&agent=${agent.id}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-mc-border hover:bg-mc-bg-tertiary transition-colors text-mc-text-secondary hover:text-mc-text"
                                        title="View logs"
                                      >
                                        <ScrollText className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">Logs</span>
                                      </a>
                                      {task.deliverable_count > 0 && (
                                        <a
                                          href={`/workspace/${task.workspace_slug}?task=${task.id}&tab=deliverables`}
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-mc-border hover:bg-mc-bg-tertiary transition-colors text-mc-text-secondary hover:text-mc-text"
                                          title="View deliverables"
                                        >
                                          <Package className="w-3.5 h-3.5" />
                                          <span className="hidden sm:inline">{task.deliverable_count}</span>
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-mc-text-secondary">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    <span>Loading agents...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Models + Default Model Selector */}
            <div className="rounded-lg border border-mc-border bg-mc-bg overflow-hidden">
              <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">
                <Cpu className="w-4 h-4 text-mc-text-secondary" />
                <h3 className="text-sm font-medium">Models</h3>
              </div>
              <div className="p-4">
                {models ? (
                  <div className="space-y-4">
                    {models.error && (
                      <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{models.error}</span>
                      </div>
                    )}

                    {/* Default model selector */}
                    <div>
                      <label className="block text-sm text-mc-text-secondary mb-2">Default Model</label>
                      <div className="flex gap-2">
                        <select
                          value={selectedModel}
                          onChange={(e) => { setSelectedModel(e.target.value); setModelSaveStatus('idle'); }}
                          disabled={savingModel || models.availableModels.length === 0}
                          className="flex-1 p-2 border border-mc-border rounded bg-mc-bg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                        >
                          {models.availableModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <button
                          onClick={async () => {
                            if (!selectedModel) return;
                            setSavingModel(true);
                            setModelSaveStatus('idle');
                            try {
                              const res = await fetch('/api/openclaw/models', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ defaultModel: selectedModel }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                setModels({ ...models, defaultModel: data.defaultModel });
                                setModelSaveStatus('saved');
                                setTimeout(() => setModelSaveStatus('idle'), 2000);
                              } else {
                                setModelSaveStatus('error');
                              }
                            } catch {
                              setModelSaveStatus('error');
                            } finally {
                              setSavingModel(false);
                            }
                          }}
                          disabled={savingModel || !selectedModel || selectedModel === models.defaultModel}
                          className="flex items-center gap-2 px-3 min-h-[38px] bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 transition-colors"
                        >
                          {modelSaveStatus === 'saved' ? (
                            <><CheckCircle2 className="w-4 h-4" /><span className="hidden sm:inline">Saved</span></>
                          ) : (
                            <><Save className="w-4 h-4" /><span className="hidden sm:inline">{savingModel ? 'Saving...' : 'Save'}</span></>
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-mc-text-secondary mt-2">Source: {models.source}</p>
                    </div>

                    {/* Model list */}
                    <div className="border-t border-mc-border pt-4 space-y-2 max-h-64 overflow-y-auto">
                      {models.availableModels.map((model) => (
                        <div
                          key={model}
                          className={`flex items-center justify-between p-2 rounded border ${
                            model === models.defaultModel
                              ? 'bg-mc-accent/10 border-mc-accent/40'
                              : 'bg-mc-bg-secondary border-mc-border'
                          }`}
                        >
                          <code className="text-sm font-mono truncate flex-1">{model}</code>
                          {model === models.defaultModel && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-mc-accent text-white rounded text-xs font-medium">
                              <Star className="w-3 h-3" />
                              Default
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {models.availableModels.length === 0 && (
                      <div className="text-center py-4 text-mc-text-secondary text-sm">
                        No models available
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-5 h-5 animate-spin text-mc-text-secondary" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editingAgent && (
        <AgentModal
          agent={editingAgent}
          onClose={() => { setEditingAgent(null); fetchData(); }}
        />
      )}
    </div>
  );
}
