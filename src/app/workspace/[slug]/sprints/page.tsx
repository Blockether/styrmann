'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Calendar,
  Flag,
  Target,
  ChevronRight,
  X,
  Loader2,
  CheckCircle2,
  Circle,
  Play,
  Pause,
  Ban,
} from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import type { Task, Workspace, Sprint, Milestone, SprintStatus } from '@/lib/types';

const SPRINT_STATUS_CONFIG: Record<SprintStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  planning: { label: 'Planning', color: 'text-mc-accent-yellow', bgColor: 'bg-mc-accent-yellow/10', icon: <Pause className="w-3.5 h-3.5" /> },
  active: { label: 'Active', color: 'text-mc-accent-green', bgColor: 'bg-mc-accent-green/10', icon: <Play className="w-3.5 h-3.5" /> },
  completed: { label: 'Completed', color: 'text-mc-accent', bgColor: 'bg-mc-accent/10', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  cancelled: { label: 'Cancelled', color: 'text-mc-text-secondary', bgColor: 'bg-mc-bg-tertiary', icon: <Ban className="w-3.5 h-3.5" /> },
};

export default function SprintsPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [loadingSprintTasks, setLoadingSprintTasks] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const wsRes = await fetch(`/api/workspaces/${slug}`);
        if (!wsRes.ok) {
          setLoading(false);
          return;
        }
        const ws = await wsRes.json();
        if (!mounted) return;
        setWorkspace(ws);

        const [sprintsRes, tasksRes, milestonesRes] = await Promise.all([
          fetch(`/api/sprints?workspace_id=${ws.id}`),
          fetch(`/api/tasks?workspace_id=${ws.id}`),
          fetch(`/api/milestones?workspace_id=${ws.id}`),
        ]);

        if (!mounted) return;

        if (sprintsRes.ok) setSprints(await sprintsRes.json());
        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
      } catch (error) {
        console.error('Failed to load sprints data:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [slug]);

  const activeSprint = useMemo(() => {
    return sprints.find((s) => s.status === 'active');
  }, [sprints]);

  const activeSprintTasks = useMemo(() => {
    if (!activeSprint) return [];
    return tasks.filter((t) => t.sprint_id === activeSprint.id);
  }, [activeSprint, tasks]);

  const activeSprintProgress = useMemo(() => {
    if (activeSprintTasks.length === 0) return 0;
    const done = activeSprintTasks.filter((t) => t.status === 'done').length;
    return Math.round((done / activeSprintTasks.length) * 100);
  }, [activeSprintTasks]);

  const activeSprintDaysRemaining = useMemo(() => {
    if (!activeSprint) return 0;
    return Math.max(0, differenceInDays(parseISO(activeSprint.end_date), new Date()));
  }, [activeSprint]);

  const sprintsByStatus = useMemo(() => {
    const groups: Record<SprintStatus, Sprint[]> = {
      planning: [],
      active: [],
      completed: [],
      cancelled: [],
    };
    for (const sprint of sprints) {
      groups[sprint.status].push(sprint);
    }
    return groups;
  }, [sprints]);

  const orderedSprints = useMemo(() => {
    return [
      ...sprintsByStatus.active,
      ...sprintsByStatus.planning,
      ...sprintsByStatus.completed,
      ...sprintsByStatus.cancelled,
    ];
  }, [sprintsByStatus]);

  const getMilestoneName = (milestoneId: string | undefined) => {
    if (!milestoneId) return null;
    return milestones.find((m) => m.id === milestoneId)?.name;
  };

  const getSprintTaskCount = (sprintId: string) => {
    return tasks.filter((t) => t.sprint_id === sprintId).length;
  };

  const getSprintDoneCount = (sprintId: string) => {
    const sprintTasks = tasks.filter((t) => t.sprint_id === sprintId);
    return sprintTasks.filter((t) => t.status === 'done').length;
  };

  const openSprintDetail = async (sprint: Sprint) => {
    setSelectedSprint(sprint);
    setLoadingSprintTasks(true);
    try {
      const res = await fetch(`/api/tasks?workspace_id=${workspace?.id}&sprint_id=${sprint.id}`);
      if (res.ok) {
        setSprintTasks(await res.json());
      }
    } catch (error) {
      console.error('Failed to load sprint tasks:', error);
    } finally {
      setLoadingSprintTasks(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Blockether" width={40} height={40} priority className="mb-3 animate-pulse rounded" />
          <p className="text-mc-text-secondary">Loading sprints...</p>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Workspace Not Found</h1>
          <Link href="/" className="text-mc-accent hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-bg pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <header className="border-b border-mc-border bg-mc-bg-secondary px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/workspace/${workspace.slug}`}
              className="min-h-11 min-w-11 px-3 rounded-lg border border-mc-border bg-mc-bg flex items-center justify-center hover:bg-mc-bg-tertiary"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold truncate">Sprints</h1>
              <p className="text-xs sm:text-sm text-mc-text-secondary truncate">{workspace.name}</p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Sprint</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {activeSprint && (
          <section className="bg-mc-bg-secondary border-2 border-mc-accent-green/40 rounded-xl p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Play className="w-4 h-4 text-mc-accent-green" />
                  <span className="text-xs font-medium uppercase text-mc-accent-green">Active Sprint</span>
                </div>
                <h2 className="text-xl font-semibold">{activeSprint.name}</h2>
                {activeSprint.goal && (
                  <p className="text-sm text-mc-text-secondary mt-1">{activeSprint.goal}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-mc-accent-green">{activeSprintDaysRemaining}</div>
                <div className="text-xs text-mc-text-secondary">days remaining</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-mc-bg rounded-lg p-3">
                <div className="text-xs text-mc-text-secondary mb-1">Start</div>
                <div className="font-medium text-sm">{format(parseISO(activeSprint.start_date), 'MMM d, yyyy')}</div>
              </div>
              <div className="bg-mc-bg rounded-lg p-3">
                <div className="text-xs text-mc-text-secondary mb-1">End</div>
                <div className="font-medium text-sm">{format(parseISO(activeSprint.end_date), 'MMM d, yyyy')}</div>
              </div>
              <div className="bg-mc-bg rounded-lg p-3">
                <div className="text-xs text-mc-text-secondary mb-1">Tasks</div>
                <div className="font-medium text-sm">{activeSprintTasks.length} total</div>
              </div>
              <div className="bg-mc-bg rounded-lg p-3">
                <div className="text-xs text-mc-text-secondary mb-1">Done</div>
                <div className="font-medium text-sm">{activeSprintTasks.filter((t) => t.status === 'done').length} completed</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-mc-text-secondary">Progress</span>
                <span className="font-medium">{activeSprintProgress}%</span>
              </div>
              <div className="h-2 bg-mc-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-mc-accent-green transition-all duration-500"
                  style={{ width: `${activeSprintProgress}%` }}
                />
              </div>
            </div>

            <button
              onClick={() => openSprintDetail(activeSprint)}
              className="mt-4 flex items-center gap-2 text-sm text-mc-accent hover:underline"
            >
              View all tasks
              <ChevronRight className="w-4 h-4" />
            </button>
          </section>
        )}

        {orderedSprints.length === 0 ? (
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-12 text-center">
            <Target className="w-10 h-10 text-mc-border mx-auto mb-3" />
            <h3 className="font-medium mb-1">No sprints yet</h3>
            <p className="text-sm text-mc-text-secondary mb-4">Create your first sprint to start organizing work</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              Create Sprint
            </button>
          </div>
        ) : (
          <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase text-mc-text-secondary">All Sprints</h3>
            <div className="grid gap-3">
              {orderedSprints.map((sprint) => {
                const config = SPRINT_STATUS_CONFIG[sprint.status];
                const taskCount = getSprintTaskCount(sprint.id);
                const doneCount = getSprintDoneCount(sprint.id);
                const milestoneName = getMilestoneName(sprint.milestone_id);
                const progress = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

                return (
                  <button
                    key={sprint.id}
                    onClick={() => openSprintDetail(sprint)}
                    className="w-full bg-mc-bg-secondary border border-mc-border rounded-xl p-4 text-left hover:border-mc-accent/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                            {config.icon}
                            {config.label}
                          </span>
                        </div>
                        <h4 className="font-medium truncate">{sprint.name}</h4>
                        {sprint.goal && (
                          <p className="text-sm text-mc-text-secondary truncate mt-0.5">{sprint.goal}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium">{taskCount} tasks</div>
                        <div className="text-xs text-mc-text-secondary">{doneCount} done</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-3 text-xs text-mc-text-secondary">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{format(parseISO(sprint.start_date), 'MMM d')} - {format(parseISO(sprint.end_date), 'MMM d, yyyy')}</span>
                      </div>
                      {milestoneName && (
                        <div className="flex items-center gap-1">
                          <Flag className="w-3.5 h-3.5" />
                          <span>{milestoneName}</span>
                        </div>
                      )}
                    </div>

                    {taskCount > 0 && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-mc-bg rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${sprint.status === 'active' ? 'bg-mc-accent-green' : sprint.status === 'completed' ? 'bg-mc-accent' : 'bg-mc-text-secondary/40'}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {showCreateModal && (
        <CreateSprintModal
          workspaceId={workspace.id}
          milestones={milestones}
          onClose={() => setShowCreateModal(false)}
          onCreated={(newSprint) => {
            setSprints((prev) => [...prev, newSprint]);
            setShowCreateModal(false);
          }}
        />
      )}

      {selectedSprint && (
        <SprintDetailModal
          sprint={selectedSprint}
          tasks={sprintTasks}
          loading={loadingSprintTasks}
          onClose={() => {
            setSelectedSprint(null);
            setSprintTasks([]);
          }}
        />
      )}
    </div>
  );
}

function CreateSprintModal({
  workspaceId,
  milestones,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  milestones: Milestone[];
  onClose: () => void;
  onCreated: (sprint: Sprint) => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !startDate || !endDate) {
      setError('Name, start date, and end date are required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name,
          goal: goal || undefined,
          start_date: startDate,
          end_date: endDate,
          milestone_id: milestoneId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create sprint');
      }

      const newSprint = await res.json();
      onCreated(newSprint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sprint');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-mc-bg-secondary border border-mc-border rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-mc-border">
          <h3 className="font-semibold">Create Sprint</h3>
          <button onClick={onClose} className="p-2 hover:bg-mc-bg-tertiary rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-mc-accent-red/10 border border-mc-accent-red/30 rounded-lg text-sm text-mc-accent-red">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Goal</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What do we want to achieve?"
              rows={2}
              className="w-full min-h-22 px-3 py-2 rounded-lg border border-mc-border bg-mc-bg text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Milestone (optional)</label>
            <select
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
            >
              <option value="">None</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 px-4 rounded-lg border border-mc-border text-sm font-medium hover:bg-mc-bg-tertiary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Sprint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SprintDetailModal({
  sprint,
  tasks,
  loading,
  onClose,
}: {
  sprint: Sprint;
  tasks: Task[];
  loading: boolean;
  onClose: () => void;
}) {
  const config = SPRINT_STATUS_CONFIG[sprint.status];
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const otherTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'in_progress');

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] bg-mc-bg-secondary border border-mc-border rounded-xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-mc-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                {config.icon}
                {config.label}
              </span>
            </div>
            <h3 className="font-semibold truncate">{sprint.name}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-mc-bg-tertiary rounded-lg shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-mc-accent" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8 text-mc-text-secondary">
              <Circle className="w-8 h-8 mx-auto mb-2 text-mc-border" />
              <p>No tasks in this sprint</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-mc-bg rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{tasks.length}</div>
                  <div className="text-xs text-mc-text-secondary">Total</div>
                </div>
                <div className="bg-mc-bg rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-mc-accent">{inProgressTasks.length}</div>
                  <div className="text-xs text-mc-text-secondary">In Progress</div>
                </div>
                <div className="bg-mc-bg rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-mc-accent-green">{doneTasks.length}</div>
                  <div className="text-xs text-mc-text-secondary">Done</div>
                </div>
              </div>

              {inProgressTasks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">In Progress</h4>
                  <div className="space-y-2">
                    {inProgressTasks.map((task) => (
                      <div key={task.id} className="bg-mc-bg border border-mc-border rounded-lg p-3">
                        <div className="font-medium text-sm">{task.title}</div>
                        <div className="text-xs text-mc-text-secondary capitalize mt-1">{task.status.replace('_', ' ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {otherTasks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Other Tasks</h4>
                  <div className="space-y-2">
                    {otherTasks.map((task) => (
                      <div key={task.id} className="bg-mc-bg border border-mc-border rounded-lg p-3">
                        <div className="font-medium text-sm">{task.title}</div>
                        <div className="text-xs text-mc-text-secondary capitalize mt-1">{task.status.replace('_', ' ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {doneTasks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-mc-accent-green">Completed</h4>
                  <div className="space-y-2">
                    {doneTasks.map((task) => (
                      <div key={task.id} className="bg-mc-bg border border-mc-accent-green/30 rounded-lg p-3 opacity-60">
                        <div className="font-medium text-sm line-through">{task.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
