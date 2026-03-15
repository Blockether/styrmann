'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Building2,
  LayoutGrid,
  Folder,
  ChevronDown,
  Check,
  Plus,
} from 'lucide-react';
import { useStyrmann } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';
import { StyrmannLogo } from '@/components/StyrmannLogo';

export type DashboardView = 'tasks' | 'backlog' | 'pareto' | 'issues' | 'discord';

interface HeaderProps {
  workspace?: Workspace;
  orgName?: string;
  orgSlug?: string;
  isPortrait?: boolean;
}

export function Header({ workspace, orgName, orgSlug, isPortrait = true }: HeaderProps) {
  const { isOnline } = useStyrmann();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [showOrgCreate, setShowOrgCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const switcherRef = useRef<HTMLDivElement>(null);
  const orgCreateRef = useRef<HTMLDivElement>(null);

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
      if (orgCreateRef.current && !orgCreateRef.current.contains(e.target as Node)) {
        setShowOrgCreate(false);
      }
    };
    if (showWorkspaceSwitcher || showOrgCreate) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showWorkspaceSwitcher, showOrgCreate]);

  const handleCreateOrganization = async () => {
    const name = newOrgName.trim();
    if (!name) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return;

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });

      if (!res.ok) {
        return;
      }

      setShowOrgCreate(false);
      setNewOrgName('');
      window.location.href = `/organization/${slug}`;
    } catch {
      return;
    }
  };


  const portraitContextHeader = isPortrait && (!!workspace || !!orgName);
  const allWorkspacesHref = orgSlug ? `/organization/${orgSlug}?tab=workspaces` : '/';

  const workspaceSwitcherDropdown = showWorkspaceSwitcher && (
    <div className="absolute top-full left-0 mt-1 w-44 sm:w-64 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
      <Link
        href={allWorkspacesHref}
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
        portraitContextHeader ? 'py-2.5 space-y-2.5 border-b border-mc-border' : 'h-14 flex items-center justify-between gap-2'
      }`}
    >
      {portraitContextHeader ? (
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Link href="/" className="flex items-center rounded px-1 py-1 transition-colors hover:bg-mc-bg-tertiary shrink-0">
                <StyrmannLogo size={20} />
              </Link>

              {workspace ? (
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
              ) : orgName ? (
                <div ref={orgCreateRef} className="relative">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-mc-bg-tertiary rounded min-w-0 overflow-hidden">
                    <Building2 className="w-4 h-4 text-mc-accent shrink-0" />
                    <span className="font-medium truncate text-sm">{orgName}</span>
                    <button
                      onClick={() => setShowOrgCreate((prev) => !prev)}
                      className="p-1 rounded hover:bg-mc-bg transition-colors"
                      title="Create organization"
                      aria-label="Create organization"
                    >
                      <Plus className="w-4 h-4 text-mc-text-secondary" />
                    </button>
                  </div>
                  {showOrgCreate && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-50 p-3">
                      <div className="text-sm font-semibold mb-2">New Organization</div>
                      <input
                        placeholder="Organization name"
                        value={newOrgName}
                        onChange={(e) => setNewOrgName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text mb-2"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setShowOrgCreate(false)} className="px-3 py-1.5 text-sm text-mc-text-secondary">Cancel</button>
                        <button
                          onClick={handleCreateOrganization}
                          className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link href="/" className="flex items-center gap-2 px-2.5 py-1.5 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="text-sm">All Organizations</span>
                </Link>
              )}
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
            <Link href="/" className="flex items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-mc-bg-tertiary">
              <StyrmannLogo size={24} />
              <h1 className="font-semibold text-mc-text uppercase tracking-wider text-sm">Styrmann</h1>
            </Link>

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
            ) : orgName ? (
              <div ref={orgCreateRef} className="relative">
                <div className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded">
                  <Building2 className="w-4 h-4 text-mc-accent" />
                  <span className="font-medium text-sm md:text-base">{orgName}</span>
                  <button
                    onClick={() => setShowOrgCreate((prev) => !prev)}
                    className="p-1 rounded hover:bg-mc-bg transition-colors"
                    title="Create organization"
                    aria-label="Create organization"
                  >
                    <Plus className="w-4 h-4 text-mc-text-secondary" />
                  </button>
                </div>
                {showOrgCreate && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-50 p-3">
                    <div className="text-sm font-semibold mb-2">New Organization</div>
                    <input
                      placeholder="Organization name"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-mc-border rounded bg-mc-bg text-mc-text mb-2"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowOrgCreate(false)} className="px-3 py-1.5 text-sm text-mc-text-secondary">Cancel</button>
                      <button
                        onClick={handleCreateOrganization}
                        className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/" className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors">
                <LayoutGrid className="w-4 h-4" />
                <span className="text-sm">All Organizations</span>
              </Link>
            )}
          </div>


          <div className="flex items-center gap-2 md:gap-4">
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
