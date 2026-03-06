'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, ChevronDown, RefreshCw, ListTodo, Inbox, BarChart3, Activity, X, Crown, CircleDot, Clock } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Agent, AgentStatus, OpenClawSession, Sprint } from '@/lib/types';
import { AgentModal } from './AgentModal';
import { AgentInitials } from './AgentInitials';
import type { DashboardView } from './Header';

type FilterTab = 'all' | 'working' | 'standby';

interface AgentsSidebarProps {
  workspaceId?: string;
  activeView?: DashboardView;
  onViewChange?: (view: DashboardView) => void;
  open?: boolean;
  onClose?: () => void;
}

const NAV_ITEMS = [
  { label: 'Active Sprint', view: 'sprint' as DashboardView, icon: <ListTodo className="w-4 h-4" /> },
  { label: 'Backlog', view: 'backlog' as DashboardView, icon: <Inbox className="w-4 h-4" /> },
  { label: 'Pareto', view: 'pareto' as DashboardView, icon: <BarChart3 className="w-4 h-4" /> },
  { label: 'Activity', view: 'activity' as DashboardView, icon: <Activity className="w-4 h-4" /> },
  { label: 'Issues', view: 'issues' as DashboardView, icon: <CircleDot className="w-4 h-4" /> },
];

export function AgentsSidebar({ 
  workspaceId, 
  activeView = 'sprint', 
  onViewChange,
  open = false,
  onClose 
}: AgentsSidebarProps) {
  const { agents, selectedAgent, setSelectedAgent, setAgents, agentOpenClawSessions, setAgentOpenClawSession, setSelectedSprintId } = useMissionControl();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [isMinimized, setIsMinimized] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [completedSprints, setCompletedSprints] = useState<Sprint[]>([]);

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  const handleNavClick = (view: DashboardView) => {
    if (onViewChange) {
      onViewChange(view);
    }
    if (onClose) {
      onClose();
    }
  };

  const loadOpenClawSessions = useCallback(async () => {
    for (const agent of agents) {
      try {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`);
        if (res.ok) {
          const data = await res.json();
          if (data.linked && data.session) {
            setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
          }
        }
      } catch (error) {
        console.error(`Failed to load OpenClaw session for ${agent.name}:`, error);
      }
    }
  }, [agents, setAgentOpenClawSession]);

  useEffect(() => {
    if (agents.length > 0) {
      loadOpenClawSessions();
    }
  }, [loadOpenClawSessions, agents.length]);

  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?session_type=subagent&status=active');
        if (res.ok) {
          const sessions = await res.json();
          setActiveSubAgents(sessions.length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();
    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!workspaceId || !historyOpen) return;
    fetch(`/api/sprints?workspace_id=${workspaceId}`)
      .then(r => r.json())
      .then(data => {
        const done = (Array.isArray(data) ? data : [])
          .filter((s: Sprint) => s.status === 'completed' || s.status === 'cancelled')
          .sort((a: Sprint, b: Sprint) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 10);
        setCompletedSprints(done);
      })
      .catch(() => {});
  }, [workspaceId, historyOpen]);

  const handleSyncGateway = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/agents/sync', { method: 'POST' });
      if (res.ok) {
        const allRes = await fetch(`/api/agents${workspaceId ? `?workspace_id=${workspaceId}` : ''}`);
        if (allRes.ok) {
          const allAgents = await allRes.json();
          setAgents(allAgents);
        }
      } else {
        const data = await res.json();
        console.error('Sync failed:', data.error);
      }
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setSyncing(false);
    }
  };

  const filteredAgents = agents.filter((agent) => {
    if (filter === 'all') return true;
    return agent.status === filter;
  });

  const getStatusBadge = (status: AgentStatus) => {
    const styles = {
      standby: 'status-standby',
      working: 'status-working',
      offline: 'status-offline',
    };
    return styles[status] || styles.standby;
  };

  if (open && onClose) {
    return (
      <div className="fixed inset-0 z-50 lg:hidden">
        <div 
          className="absolute inset-0 bg-black/50" 
          onClick={onClose}
        />
        <aside
          data-component="src/components/AgentsSidebar"
          className="absolute left-0 top-0 h-full w-72 bg-mc-bg-secondary shadow-xl flex flex-col border-r border-mc-border"
        >
          <div className="p-3 border-b border-mc-border flex items-center justify-between">
            <span className="text-sm font-medium uppercase tracking-wider">Menu</span>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 border-b border-mc-border">
            <span className="text-xs font-medium uppercase tracking-wider text-mc-text-secondary mb-2 block">Views</span>
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = activeView === item.view;
                return (
                  <button
                    key={item.view}
                    onClick={() => handleNavClick(item.view)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                      isActive ? 'bg-mc-accent text-white font-medium' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sprint History - mobile */}
          <div className="border-b border-mc-border">
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="w-full p-3 flex items-center justify-between text-sm text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="uppercase tracking-wider font-medium text-xs">History</span>
              </div>
              {historyOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {historyOpen && (
              <div className="px-2 pb-2 space-y-1">
                {completedSprints.length === 0 ? (
                  <p className="text-xs text-mc-text-secondary px-3 py-2">No completed sprints</p>
                ) : (
                  completedSprints.map(sprint => (
                    <button
                      key={sprint.id}
                      onClick={() => {
                        setSelectedSprintId(sprint.id);
                        handleNavClick('sprint');
                      }}
                      className="w-full text-left px-3 py-2 rounded text-xs hover:bg-mc-bg-tertiary transition-colors"
                    >
                      <div className="font-medium text-mc-text truncate">{sprint.name}</div>
                      <div className="text-mc-text-secondary mt-0.5">
                        {sprint.status === 'completed' ? 'Completed' : 'Cancelled'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="p-3 border-b border-mc-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-mc-text-secondary">Agents</span>
              <span className="bg-mc-bg-tertiary text-mc-text-secondary text-xs px-2 py-0.5 rounded">{agents.length}</span>
            </div>
            {activeSubAgents > 0 && (
              <div className="mb-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-400">●</span>
                  <span className="text-mc-text">Active Sub-Agents:</span>
                  <span className="font-bold text-green-400">{activeSubAgents}</span>
                </div>
              </div>
            )}
            <div className="flex gap-1">
              {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`flex-1 min-h-9 text-xs rounded uppercase ${
                    filter === tab ? 'bg-mc-accent text-white font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredAgents.map((agent) => {
              const openclawSession = agentOpenClawSessions[agent.id];
              const isSynced = agent.source === 'synced' || agent.source === 'gateway';

              return (
                <div key={agent.id} className={`w-full rounded hover:bg-mc-bg-tertiary transition-colors ${selectedAgent?.id === agent.id ? 'bg-mc-bg-tertiary' : ''} ${agent.role === 'orchestrator' ? 'bg-amber-50 border border-amber-300' : ''}`}>
                  <button
                    onClick={() => {
                      setSelectedAgent(agent);
                      setEditingAgent(agent);
                    }}
                    className="w-full flex items-center gap-3 p-3 text-left min-h-11"
                  >
                    <div className="relative">
                      <AgentInitials name={agent.name} size="md" />
                      {(openclawSession || isSynced) && <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{agent.name}</span>
                        {agent.role === 'orchestrator' && <Crown className="w-3 h-3 text-amber-500" />}
                      </div>
                      <div className="text-xs text-mc-text-secondary truncate flex items-center gap-1">
                        {agent.role === 'orchestrator' ? 'Product Owner' : agent.role}
                        {isSynced && (
                          <span className="text-[10px] px-1 py-0 bg-mc-accent/20 text-mc-accent rounded" title="Synced from Gateway">
                            SYNC
                          </span>
                        )}
                      </div>
                    </div>

                    <span className={`text-xs px-2 py-0.5 rounded uppercase ${getStatusBadge(agent.status)}`}>{agent.status}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-mc-border">
            <button
              onClick={handleSyncGateway}
              disabled={syncing}
              className="w-full min-h-11 flex items-center justify-center gap-2 px-3 bg-mc-accent/10 hover:bg-mc-accent/20 border border-mc-accent/20 rounded text-sm text-mc-accent hover:text-mc-accent/80 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync with Gateway'}
            </button>
          </div>

          {editingAgent && <AgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} workspaceId={workspaceId} />}
        </aside>
      </div>
    );
  }

  return (
    <aside
      data-component="src/components/AgentsSidebar"
      className={`hidden lg:flex bg-mc-bg-secondary border-r border-mc-border flex-col transition-all duration-300 ease-in-out ${
        isMinimized ? 'w-12' : 'w-[32rem]'
      }`}
    >
      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          <button
            onClick={toggleMinimize}
            className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
            aria-label={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          {!isMinimized && (
            <span className="text-sm font-medium uppercase tracking-wider ml-1">Views</span>
          )}
        </div>

        {!isMinimized && (
          <div className="mt-2 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => handleNavClick(item.view)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                    isActive ? 'bg-mc-accent text-white font-medium' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {isMinimized && (
          <div className="mt-2 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => handleNavClick(item.view)}
                  className={`w-full flex justify-center py-2 rounded transition-colors ${
                    isActive ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
                  }`}
                  title={item.label}
                >
                  {item.icon}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sprint History - desktop */}
      {!isMinimized && (
        <div className="border-b border-mc-border">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full p-3 flex items-center justify-between text-sm text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="uppercase tracking-wider font-medium text-xs">History</span>
            </div>
            {historyOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {historyOpen && (
            <div className="px-2 pb-2 space-y-1">
              {completedSprints.length === 0 ? (
                <p className="text-xs text-mc-text-secondary px-3 py-2">No completed sprints</p>
              ) : (
                completedSprints.map(sprint => (
                  <button
                    key={sprint.id}
                    onClick={() => {
                      setSelectedSprintId(sprint.id);
                      handleNavClick('sprint');
                    }}
                    className="w-full text-left px-3 py-2 rounded text-xs hover:bg-mc-bg-tertiary transition-colors"
                  >
                    <div className="font-medium text-mc-text truncate">{sprint.name}</div>
                    <div className="text-mc-text-secondary mt-0.5">
                      {sprint.status === 'completed' ? 'Completed' : 'Cancelled'}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {isMinimized && (
        <div className="border-b border-mc-border">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className={`w-full flex justify-center py-2 rounded transition-colors ${historyOpen ? 'bg-mc-accent/10 text-mc-accent' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'}`}
            title="Sprint History"
          >
            <Clock className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="border-b border-mc-border" />

      <div className="p-3 border-b border-mc-border">
        <div className="flex items-center">
          {!isMinimized && (
            <>
              <span className="text-sm font-medium uppercase tracking-wider">Agents</span>
              <span className="bg-mc-bg-tertiary text-mc-text-secondary text-xs px-2 py-0.5 rounded ml-2">{agents.length}</span>
            </>
          )}
        </div>

        {!isMinimized && (
          <>
            {activeSubAgents > 0 && (
              <div className="mb-3 mt-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-green-400">●</span>
                  <span className="text-mc-text">Active Sub-Agents:</span>
                  <span className="font-bold text-green-400">{activeSubAgents}</span>
                </div>
              </div>
            )}

            <div className="mt-3 flex gap-1">
              {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`flex-1 min-h-9 text-xs rounded uppercase ${
                    filter === tab ? 'bg-mc-accent text-white font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredAgents.map((agent) => {
          const openclawSession = agentOpenClawSessions[agent.id];
          const isSynced = agent.source === 'synced' || agent.source === 'gateway';

          if (isMinimized) {
            return (
              <div key={agent.id} className="flex justify-center py-3">
                <button
                  onClick={() => {
                    setSelectedAgent(agent);
                    setEditingAgent(agent);
                  }}
                  className="relative group"
                  title={`${agent.name}${agent.role ? ' — ' + (agent.role.length > 40 ? agent.role.slice(0, 40) + '…' : agent.role) : ''}`}
                >
                  <AgentInitials name={agent.name} size="md" />
                  {(openclawSession || isSynced) && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />}
                  {agent.role === 'orchestrator' && <span className="absolute -top-1 -right-1 text-amber-500"><Crown className="w-3 h-3" /></span>}
                  <span
                    className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                      agent.status === 'working' ? 'bg-mc-accent-green' : agent.status === 'standby' ? 'bg-mc-text-secondary' : 'bg-gray-500'
                    }`}
                  />
                  <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-mc-bg text-mc-text text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 border border-mc-border">
                    {agent.name}
                  </div>
                </button>
              </div>
            );
          }

          return (
            <div key={agent.id} className={`w-full rounded hover:bg-mc-bg-tertiary transition-colors ${selectedAgent?.id === agent.id ? 'bg-mc-bg-tertiary' : ''} ${agent.role === 'orchestrator' ? 'bg-amber-50 border border-amber-300' : ''}`}>
              <button
                onClick={() => {
                  setSelectedAgent(agent);
                  setEditingAgent(agent);
                }}
                className="w-full flex items-center gap-3 p-3 text-left min-h-11"
              >
                <div className="relative">
                  <AgentInitials name={agent.name} size="md" />
                  {(openclawSession || isSynced) && <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{agent.name}</span>
                    {agent.role === 'orchestrator' && <Crown className="w-3 h-3 text-amber-500" />}
                  </div>
                  <div className="text-xs text-mc-text-secondary truncate flex items-center gap-1">
                    {agent.role === 'orchestrator' ? 'Product Owner' : agent.role}
                    {isSynced && (
                      <span className="text-[10px] px-1 py-0 bg-mc-accent/20 text-mc-accent rounded" title="Synced from Gateway">
                        SYNC
                      </span>
                    )}
                  </div>
                </div>

                <span className={`text-xs px-2 py-0.5 rounded uppercase ${getStatusBadge(agent.status)}`}>{agent.status}</span>
              </button>
            </div>
          );
        })}
      </div>

      {!isMinimized && (
        <div className="p-3 border-t border-mc-border space-y-2">
          <button
            onClick={handleSyncGateway}
            disabled={syncing}
            className="w-full min-h-11 flex items-center justify-center gap-2 px-3 bg-mc-accent/10 hover:bg-mc-accent/20 border border-mc-accent/20 rounded text-sm text-mc-accent hover:text-mc-accent/80 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync with Gateway'}
          </button>
        </div>
      )}

      {editingAgent && <AgentModal agent={editingAgent} onClose={() => setEditingAgent(null)} workspaceId={workspaceId} />}
    </aside>
  );
}
