'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  LayoutGrid,
  Folder,
  Menu,
  X,
  ChevronDown,
  Check,
  Activity,
  Bot,
  Mail,
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
  const { isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
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


  const portraitWorkspaceHeader = !!workspace && isPortrait;

  const workspaceSwitcherDropdown = showWorkspaceSwitcher && (
    <div className="absolute top-full left-0 mt-1 w-44 sm:w-64 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
      <Link
        href="/"
        onClick={() => setShowWorkspaceSwitcher(false)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary transition-colors"
      >
        <LayoutGrid className="w-4 h-4" />
        All Workspaces
      </Link>
      <Link
        href="/operations"
        onClick={() => setShowWorkspaceSwitcher(false)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary transition-colors"
      >
        <Activity className="w-4 h-4" />
        Operations
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
            <div className="flex items-center gap-2 min-w-0 flex-1">
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
                aria-label="Switch workspace"
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

            <div className="flex items-center gap-2 shrink-0">
              <span
                title={isOnline ? "System Online" : "System Offline"}
                className={`w-3 h-3 rounded-full shrink-0 cursor-default ${
                  isOnline ? "bg-mc-accent-green animate-pulse" : "bg-mc-accent-red"
                }`}
              />
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
              <h1 className="font-semibold text-mc-text uppercase tracking-wider text-sm">Mission Control</h1>
            </div>

            {workspace ? (
              <div ref={switcherRef} className="relative flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setShowWorkspaceSwitcher(!showWorkspaceSwitcher)}
                  aria-label="Switch workspace"
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


          <div className="flex items-center gap-2 md:gap-4">
            {workspace && (
              <div className="flex items-center gap-2">
                <Link
                  href="/operations#openclaw"
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary transition-colors text-sm text-mc-text"
                >
                  <Bot className="w-4 h-4 text-mc-accent" />
                  <span className="hidden md:inline">Manage Agents</span>
                </Link>
                <Link
                  href="/operations#humans"
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary transition-colors text-sm text-mc-text"
                >
                  <Mail className="w-4 h-4 text-mc-accent" />
                  <span className="hidden md:inline">Manage Humans</span>
                </Link>
              </div>
            )}
            <span className="hidden md:block text-mc-text-secondary text-sm font-mono">{format(currentTime, 'HH:mm:ss')}</span>
            <span
              title={isOnline ? "System Online" : "System Offline"}
              className={`w-3 h-3 rounded-full shrink-0 cursor-default ${
                isOnline ? "bg-mc-accent-green animate-pulse" : "bg-mc-accent-red"
              }`}
            />
          </div>
        </>
      )}
    </header>
  );
}
