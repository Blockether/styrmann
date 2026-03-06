'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Settings,
  ChevronLeft,
  LayoutGrid,
  Folder,
  Menu,
  X,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

export type DashboardView = 'sprint' | 'backlog' | 'pareto' | 'activity' | 'issues';

interface HeaderProps {
  workspace?: Workspace;
  isPortrait?: boolean;
  onMenuToggle?: () => void;
  sidebarOpen?: boolean;
}

export function Header({ workspace, isPortrait = true, onMenuToggle, sidebarOpen }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
    const loadWorkspaces = async () => {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          const data = await res.json();
          setAllWorkspaces(data);
        }
      } catch (error) {
        console.error('Failed to load workspaces:', error);
      }
    };
    loadWorkspaces();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowWorkspaceSwitcher(false);
      }
    };
    if (showWorkspaceSwitcher) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showWorkspaceSwitcher]);

  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  const tasksInQueue = tasks.filter((t) => t.status !== 'done' && t.status !== 'review').length;

  const portraitWorkspaceHeader = !!workspace && isPortrait;

  const workspaceSwitcherDropdown = showWorkspaceSwitcher && (
    <div className="absolute top-full left-0 mt-1 w-64 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
      <Link
        href="/"
        onClick={() => setShowWorkspaceSwitcher(false)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary transition-colors"
      >
        <LayoutGrid className="w-4 h-4" />
        All Workspaces
      </Link>
      <div className="border-t border-mc-border my-1" />
      {allWorkspaces.map((ws) => (
        <Link
          key={ws.id}
          href={`/workspace/${ws.slug}`}
          onClick={() => setShowWorkspaceSwitcher(false)}
          className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-mc-bg-tertiary transition-colors ${
            workspace?.id === ws.id ? 'text-mc-accent font-medium' : 'text-mc-text'
          }`}
        >
          {ws.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ws.logo_url} alt={ws.name} className="w-4 h-4 rounded object-contain shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-mc-accent shrink-0" />
          )}
          <span className="truncate">{ws.name}</span>
          {workspace?.id === ws.id && <Check className="w-4 h-4 ml-auto shrink-0" />}
        </Link>
      ))}
    </div>
  );

  return (
    <header
      data-component="src/components/Header"
      className={`bg-mc-bg-secondary px-3 md:px-4 ${
        portraitWorkspaceHeader ? 'py-2.5 space-y-2.5 border-b border-mc-border' : 'h-14 flex items-center justify-between gap-2'
      }`}
    >
      {portraitWorkspaceHeader ? (
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={onMenuToggle}
                className="lg:hidden min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary shrink-0"
                title="Menu"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div ref={switcherRef} className="relative min-w-0">
                <button
                  onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-mc-bg-tertiary rounded min-w-0 overflow-hidden hover:bg-mc-bg transition-colors"
                >
                  {workspace.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={workspace.logo_url} alt={workspace.name} className="w-4 h-4 rounded object-contain shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 text-mc-accent shrink-0" />
                  )}
                  <span className="font-medium truncate text-sm">{workspace.name}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-mc-text-secondary shrink-0" />
                </button>
                {workspaceSwitcherDropdown}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 min-h-11 rounded border text-xs font-medium ${
                  isOnline
                    ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
                    : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </div>

              <button onClick={() => router.push('/settings')} className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary shrink-0" title="Settings">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="min-h-11 rounded border border-mc-border bg-mc-bg-tertiary px-2 flex items-center justify-center gap-1.5 text-xs">
                <span className="text-mc-accent-cyan font-semibold">{activeAgents}</span>
                <span className="text-mc-text-secondary">active</span>
              </div>
              <div className="min-h-11 rounded border border-mc-border bg-mc-bg-tertiary px-2 flex items-center justify-center gap-1.5 text-xs">
                <span className="text-mc-accent-purple font-semibold">{tasksInQueue}</span>
                <span className="text-mc-text-secondary">queued</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button
              onClick={onMenuToggle}
              className="lg:hidden min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary shrink-0"
              title="Menu"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="hidden sm:flex items-center gap-2">
              <Image src="/logo.png" alt="Blockether" width={24} height={24} className="rounded" />
              <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">Blockether</span>
            </div>

            {workspace ? (
              <div ref={switcherRef} className="relative flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)}
                  className="flex items-center gap-2 px-2 md:px-3 py-1 bg-mc-bg-tertiary rounded min-w-0 hover:bg-mc-bg transition-colors"
                >
                  {workspace.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={workspace.logo_url} alt={workspace.name} className="w-4 h-4 rounded object-contain shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 text-mc-accent shrink-0" />
                  )}
                  <span className="font-medium truncate text-sm md:text-base">{workspace.name}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-mc-text-secondary shrink-0" />
                </button>
                {workspaceSwitcherDropdown}
              </div>
            ) : (
              <Link href="/" className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors">
                <LayoutGrid className="w-4 h-4" />
                <span className="text-sm">All Workspaces</span>
              </Link>
            )}
          </div>

          {workspace && (
            <div className="hidden lg:flex items-center gap-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-mc-accent-cyan">{activeAgents}</div>
                <div className="text-xs text-mc-text-secondary uppercase">Agents Active</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
                <div className="text-xs text-mc-text-secondary uppercase">Tasks in Queue</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 md:gap-4">
            <span className="hidden md:block text-mc-text-secondary text-sm font-mono">{format(currentTime, 'HH:mm:ss')}</span>
            <div
              className={`flex items-center gap-2 px-2 md:px-3 py-1 rounded border text-xs md:text-sm font-medium ${
                isOnline
                  ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
                  : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'}`} />
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </div>
            <button onClick={() => router.push('/settings')} className="min-h-11 min-w-11 p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary" title="Settings">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </header>
  );
}
