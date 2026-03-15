'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Header, type DashboardView } from '@/components/Header';
import { StyrmannLogo } from '@/components/StyrmannLogo';

import { WorkspaceTasks } from '@/components/WorkspaceTasks';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { GithubIssuesView } from '@/components/GithubIssuesView';
import { DiscordMessagesView } from '@/components/DiscordMessagesView';
import { useStyrmann } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import type { Task, Workspace } from '@/lib/types';

function getInitialView(): DashboardView {
  if (typeof window === 'undefined') return 'tasks';
  const params = new URLSearchParams(window.location.search);
  const urlView = params.get('view');
  if (urlView && ['tasks', 'issues', 'discord'].includes(urlView)) {
    return urlView as DashboardView;
  }
  return 'tasks';
}

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;

  const { setAgents, setTasks, setIsOnline, setIsLoading, isLoading } = useStyrmann();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<DashboardView>(getInitialView);

  const [isPortrait, setIsPortrait] = useState(true);

  useSSE();

  useEffect(() => {
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && ['tasks', 'issues', 'discord'].includes(urlView)) {
      return;
    }
    if (urlView) {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleViewChange = (newView: DashboardView) => {
    setView(newView);
    const url = new URL(window.location.href);
    if (newView === 'tasks') {
      url.searchParams.delete('view');
    } else {
      url.searchParams.set('view', newView);
    }
    window.history.replaceState({}, '', url.toString());
  };

  useEffect(() => {
    const media = window.matchMedia('(orientation: portrait)');
    const updateOrientation = () => setIsPortrait(media.matches);

    updateOrientation();
    media.addEventListener('change', updateOrientation);
    window.addEventListener('resize', updateOrientation);

    return () => {
      media.removeEventListener('change', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
    }

    loadWorkspace();
  }, [slug, setIsLoading]);



  useEffect(() => {
    if (!workspace) return;

    const workspaceId = workspace.id;

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });

        const [agentsRes, tasksRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/tasks?workspace_id=${workspaceId}`),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          debug.api('Loaded tasks', { count: tasksData.length });
          setTasks(tasksData);
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    setIsOnline(true);

    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
        if (res.ok) {
          const newTasks: Task[] = await res.json();
          const currentTasks = useStyrmann.getState().tasks;

          const hasChanges =
            newTasks.length !== currentTasks.length ||
            newTasks.some((t) => {
              const current = currentTasks.find((ct) => ct.id === t.id);
              return !current || current.updated_at !== t.updated_at;
            });

          if (hasChanges) {
            debug.api('[FALLBACK] Task changes detected via polling, updating store');
            setTasks(newTasks);
          }
        }
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      }
    }, 60000);

    return () => {
      clearInterval(taskPoll);
    };
  }, [workspace, setAgents, setTasks, setIsOnline, setIsLoading]);

  const renderView = () => {
    if (!workspace) return null;
    switch (view) {
      case 'tasks':
        return <WorkspaceTasks workspaceId={workspace.id} />;
      case 'issues':
        return <GithubIssuesView workspaceId={workspace.id} workspace={workspace} />;
      case 'discord':
        return <DiscordMessagesView workspaceId={workspace.id} />;
      default:
        return <WorkspaceTasks workspaceId={workspace.id} />;
    }
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl font-bold text-mc-text-secondary mb-4">Not Found</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-white rounded-lg font-medium hover:bg-mc-accent/90">
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <StyrmannLogo size={40} className="mb-4 animate-pulse" />
          <p className="text-mc-text-secondary">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const orgSlug = workspace.organization
    ? workspace.organization.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : undefined;

  return (
    <div data-component="src/app/workspace/[slug]/page" className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-mc-accent focus:text-white focus:rounded focus:text-sm focus:font-medium">
        Skip to content
      </a>
      <Header 
        workspace={workspace} 
        orgSlug={orgSlug}
        isPortrait={isPortrait} 
      />

      <div className="border-b border-mc-border bg-mc-bg-secondary flex items-center px-3 gap-0 shrink-0 overflow-x-auto">
        {[
          { key: 'tasks', label: 'Tasks' },
          { key: 'issues', label: 'Issues' },
          { key: 'discord', label: 'Discord' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleViewChange(tab.key as DashboardView)}
            className={`px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
              view === tab.key
                ? 'border-mc-accent text-mc-text font-medium'
                : 'border-transparent text-mc-text-secondary hover:text-mc-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main id="main-content" className="flex-1 min-w-0 overflow-hidden flex flex-col">{renderView()}</main>

      <SSEDebugPanel />
    </div>
  );
}
