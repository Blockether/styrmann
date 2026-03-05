'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ListTodo, Users, Activity, Inbox, BarChart3 } from 'lucide-react';
import { Header, type DashboardView } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { ActiveSprint } from '@/components/ActiveSprint';
import { BacklogView } from '@/components/BacklogView';
import { ParetoView } from '@/components/ParetoView';
import { AgentActivityDashboard } from '@/components/AgentActivityDashboard';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { debug } from '@/lib/debug';
import type { Task, Workspace } from '@/lib/types';

type MobileTab = 'content' | 'agents' | 'feed';

const VIEW_LABELS: Record<DashboardView, string> = {
  sprint: 'Sprint',
  backlog: 'Backlog',
  pareto: 'Pareto',
  activity: 'Activity',
};

const VIEW_ICONS: Record<DashboardView, React.ReactNode> = {
  sprint: <ListTodo className="w-4 h-4" />,
  backlog: <Inbox className="w-4 h-4" />,
  pareto: <BarChart3 className="w-4 h-4" />,
  activity: <Activity className="w-4 h-4" />,
};

function getInitialView(): DashboardView {
  if (typeof window === 'undefined') return 'sprint';
  const params = new URLSearchParams(window.location.search);
  const urlView = params.get('view');
  if (urlView && ['sprint', 'backlog', 'pareto', 'activity'].includes(urlView)) {
    return urlView as DashboardView;
  }
  return 'sprint';
}

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;

  const { setAgents, setTasks, setEvents, setIsOnline, setIsLoading, isLoading } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<DashboardView>(getInitialView);
  const [mobileTab, setMobileTab] = useState<MobileTab>('content');
  const [isPortrait, setIsPortrait] = useState(true);

  useSSE();

  useEffect(() => {
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && ['sprint', 'backlog', 'pareto', 'activity'].includes(urlView)) {
      setView(urlView as DashboardView);
    }
  }, []);

  const handleViewChange = (newView: DashboardView) => {
    setView(newView);
    const url = new URL(window.location.href);
    if (newView === 'sprint') {
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

        const [agentsRes, tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/tasks?workspace_id=${workspaceId}`),
          fetch('/api/events'),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          debug.api('Loaded tasks', { count: tasksData.length });
          setTasks(tasksData);
        }
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    async function checkOpenClaw() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const openclawRes = await fetch('/api/openclaw/status', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (openclawRes.ok) {
          const status = await openclawRes.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }

    loadData();
    checkOpenClaw();

    const eventPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/events?limit=20');
        if (res.ok) {
          setEvents(await res.json());
        }
      } catch (error) {
        console.error('Failed to poll events:', error);
      }
    }, 30000);

    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
        if (res.ok) {
          const newTasks: Task[] = await res.json();
          const currentTasks = useMissionControl.getState().tasks;

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

    const connectionCheck = setInterval(async () => {
      try {
        const res = await fetch('/api/openclaw/status');
        if (res.ok) {
          const status = await res.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }, 30000);

    return () => {
      clearInterval(eventPoll);
      clearInterval(connectionCheck);
      clearInterval(taskPoll);
    };
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading]);

  const renderView = () => {
    if (!workspace) return null;
    switch (view) {
      case 'sprint':
        return <ActiveSprint workspaceId={workspace.id} />;
      case 'backlog':
        return <BacklogView workspaceId={workspace.id} />;
      case 'pareto':
        return <ParetoView workspaceId={workspace.id} />;
      case 'activity':
        return <AgentActivityDashboard workspace={workspace} embedded />;
      default:
        return <ActiveSprint workspaceId={workspace.id} />;
    }
  };

  const renderMobileView = (mobileMode: boolean, portrait: boolean) => {
    if (!workspace) return null;
    switch (view) {
      case 'sprint':
        return <ActiveSprint workspaceId={workspace.id} mobileMode={mobileMode} isPortrait={portrait} />;
      case 'backlog':
        return <BacklogView workspaceId={workspace.id} />;
      case 'pareto':
        return <ParetoView workspaceId={workspace.id} />;
      case 'activity':
        return <AgentActivityDashboard workspace={workspace} embedded />;
      default:
        return <ActiveSprint workspaceId={workspace.id} mobileMode={mobileMode} isPortrait={portrait} />;
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
          <Image src="/logo.png" alt="Blockether" width={40} height={40} priority className="mb-4 animate-pulse rounded" />
          <p className="text-mc-text-secondary">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div data-component="src/app/workspace/[slug]/page" className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header workspace={workspace} isPortrait={isPortrait} activeView={view} onViewChange={handleViewChange} />

      <div className="hidden lg:flex flex-1 overflow-hidden">
        <AgentsSidebar workspaceId={workspace.id} />
        {renderView()}
        <LiveFeed />
      </div>

      <div className="lg:hidden flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {isPortrait ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-mc-border bg-mc-bg-secondary shrink-0">
              <button
                onClick={() => setMobileTab('content')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mobileTab === 'content' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {VIEW_ICONS[view]}
                {VIEW_LABELS[view]}
              </button>
              <button
                onClick={() => setMobileTab('agents')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mobileTab === 'agents' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <Users className="w-4 h-4" />
                Agents
              </button>
              <button
                onClick={() => setMobileTab('feed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mobileTab === 'feed' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <Activity className="w-4 h-4" />
                Feed
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mobileTab === 'content' && renderMobileView(true, true)}
              {mobileTab === 'agents' && (
                <div className="h-full p-3 overflow-y-auto">
                  <AgentsSidebar workspaceId={workspace.id} mobileMode isPortrait />
                </div>
              )}
              {mobileTab === 'feed' && (
                <div className="h-full p-3 overflow-y-auto">
                  <LiveFeed mobileMode isPortrait />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full p-3 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3">
            {renderMobileView(true, false)}
            <div className="min-w-0 h-full flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMobileTab('agents')}
                  className={`min-h-11 rounded-lg text-xs ${mobileTab === 'agents' ? 'bg-mc-accent text-white font-medium' : 'bg-mc-bg-secondary border border-mc-border text-mc-text-secondary'}`}
                >
                  Agents
                </button>
                <button
                  onClick={() => setMobileTab('feed')}
                  className={`min-h-11 rounded-lg text-xs ${mobileTab === 'feed' ? 'bg-mc-accent text-white font-medium' : 'bg-mc-bg-secondary border border-mc-border text-mc-text-secondary'}`}
                >
                  Feed
                </button>
              </div>

              <div className="min-h-0 flex-1">
                {mobileTab === 'agents' ? (
                  <AgentsSidebar workspaceId={workspace.id} mobileMode isPortrait={false} />
                ) : (
                  <LiveFeed mobileMode isPortrait={false} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <SSEDebugPanel />
    </div>
  );
}
