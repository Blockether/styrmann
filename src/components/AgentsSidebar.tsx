'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronLeft, ChevronDown, ListTodo, Inbox, BarChart3, Activity, X, CircleDot, Clock, Cpu, Bot } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Sprint } from '@/lib/types';
import type { DashboardView } from './Header';

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

interface AgentSummary {
  total: number;
  working: number;
}

export function AgentsSidebar({
  workspaceId,
  activeView = 'sprint',
  onViewChange,
  open = false,
  onClose
}: AgentsSidebarProps) {
  const { setSelectedSprintId } = useMissionControl();
  const [isMinimized, setIsMinimized] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [completedSprints, setCompletedSprints] = useState<Sprint[]>([]);
  const [agentSummary, setAgentSummary] = useState<AgentSummary>({ total: 0, working: 0 });

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  const handleNavClick = (view: DashboardView) => {
    if (onViewChange) onViewChange(view);
    if (onClose) onClose();
  };

  // Load agent summary (lightweight — just counts)
  const loadAgentSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const agents = await res.json();
        const arr = Array.isArray(agents) ? agents : [];
        setAgentSummary({
          total: arr.length,
          working: arr.filter((a: { status: string }) => a.status === 'working').length,
        });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadAgentSummary(); // eslint-disable-line react-hooks/set-state-in-effect -- standard data fetch on mount
    const interval = setInterval(loadAgentSummary, 30000);
    return () => clearInterval(interval);
  }, [loadAgentSummary]);

  // Sprint history
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

  // Shared nav rendering
  const renderNav = (minimized: boolean) => (
    <div className={minimized ? 'space-y-1' : 'space-y-1'}>
      {NAV_ITEMS.map((item) => {
        const isActive = activeView === item.view;
        return (
          <button
            key={item.view}
            onClick={() => handleNavClick(item.view)}
            className={`w-full flex ${minimized ? 'justify-center py-2' : 'items-center gap-3 px-3 py-2'} rounded text-sm transition-colors ${
              isActive ? 'bg-mc-accent text-white font-medium' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
            }`}
            title={minimized ? item.label : undefined}
          >
            {item.icon}
            {!minimized && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>
  );

  // Shared sprint history rendering
  const renderSprintHistory = (minimized: boolean) => (
    <div className="border-b border-mc-border">
      {minimized ? (
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className={`w-full flex justify-center py-2 rounded transition-colors ${historyOpen ? 'bg-mc-accent/10 text-mc-accent' : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'}`}
          title="Sprint History"
        >
          <Clock className="w-4 h-4" />
        </button>
      ) : (
        <>
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
        </>
      )}
    </div>
  );

  // Shared OpenClaw summary link
  const renderOpenClawLink = (minimized: boolean) => (
    <div className="mt-auto p-2 border-t border-mc-border">
      <Link
        href="/operations#openclaw"
        className={`group relative overflow-hidden rounded-lg border border-mc-border bg-mc-bg hover:bg-mc-bg-tertiary/70 transition-colors ${minimized ? 'flex justify-center py-2.5' : 'flex items-center gap-3 px-3 py-2.5'}`}
        title={minimized ? `${agentSummary.total} agents, ${agentSummary.working} working` : undefined}
      >
        <div className={`relative flex-shrink-0 rounded-md border border-mc-border bg-mc-bg-secondary ${minimized ? 'p-1.5' : 'p-1.5'}`}>
          <Cpu className="w-4 h-4 text-mc-text-secondary group-hover:text-mc-accent transition-colors" />
          {agentSummary.working > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-mc-accent ring-2 ring-mc-bg" />
          )}
        </div>
        {!minimized && (
          <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-mc-text leading-none">Operations</p>
              <p className="mt-1 text-[11px] text-mc-text-secondary truncate">
                {agentSummary.total} total agents
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-mc-border bg-mc-bg-secondary text-mc-text-secondary">
                <Bot className="w-3 h-3" />
                <span className="font-medium">{agentSummary.total}</span>
              </span>
              {agentSummary.working > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-mc-accent/30 bg-mc-accent/10 text-mc-accent font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-mc-accent" />
                  {agentSummary.working} active
                </span>
              )}
            </div>
          </div>
        )}
      </Link>
    </div>
  );

  // Mobile overlay
  if (open && onClose) {
    return (
      <div className="fixed inset-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
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
            <nav aria-label="Workspace views">
              {renderNav(false)}
            </nav>
          </div>

          {renderSprintHistory(false)}
          {renderOpenClawLink(false)}
        </aside>
      </div>
    );
  }

  // Desktop sidebar
  return (
    <aside
      data-component="src/components/AgentsSidebar"
      className={`hidden lg:flex bg-mc-bg-secondary border-r border-mc-border flex-col transition-all duration-300 ease-in-out ${
        isMinimized ? 'w-12' : 'w-64'
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
        <div className="mt-2">
          {renderNav(isMinimized)}
        </div>
      </div>

      {renderSprintHistory(isMinimized)}
      {renderOpenClawLink(isMinimized)}
    </aside>
  );
}
