'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Calendar,
  Target,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Milestone as MilestoneIcon,
} from 'lucide-react';
import { format, differenceInDays, parseISO, isBefore, startOfDay } from 'date-fns';
import type { Task, Workspace, Milestone, MilestoneStatus } from '@/lib/types';

const MILESTONE_STATUS_CONFIG: Record<MilestoneStatus, { label: string; color: string; bgColor: string }> = {
  open: { label: 'Open', color: 'text-mc-accent', bgColor: 'bg-mc-accent/10' },
  closed: { label: 'Closed', color: 'text-mc-accent-green', bgColor: 'bg-mc-accent-green/10' },
};

type MilestoneHealth = 'overdue' | 'upcoming' | 'on-track';

export default function MilestonesPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);

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

        const [milestonesRes, tasksRes] = await Promise.all([
          fetch(`/api/milestones?workspace_id=${ws.id}`),
          fetch(`/api/tasks?workspace_id=${ws.id}`),
        ]);

        if (!mounted) return;

        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (tasksRes.ok) setTasks(await tasksRes.json());
      } catch (error) {
        console.error('Failed to load milestones data:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [slug]);

  const sortedMilestones = useMemo(() => {
    return [...milestones].sort((a, b) => {
      if (a.status === 'closed' && b.status !== 'closed') return 1;
      if (a.status !== 'closed' && b.status === 'closed') return -1;
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }, [milestones]);

  const getMilestoneHealth = (milestone: Milestone): MilestoneHealth => {
    if (milestone.status === 'closed') return 'on-track';
    if (!milestone.due_date) return 'on-track';
    const dueDate = startOfDay(parseISO(milestone.due_date));
    const today = startOfDay(new Date());
    if (isBefore(dueDate, today)) return 'overdue';
    if (differenceInDays(dueDate, today) <= 7) return 'upcoming';
    return 'on-track';
  };

  const getMilestoneTasks = (milestoneId: string) => {
    return tasks.filter((t) => t.milestone_id === milestoneId);
  };

  const getMilestoneProgress = (milestoneId: string) => {
    const milestoneTasks = getMilestoneTasks(milestoneId);
    if (milestoneTasks.length === 0) return 0;
    const done = milestoneTasks.filter((t) => t.status === 'done').length;
    return Math.round((done / milestoneTasks.length) * 100);
  };

  const getHealthStyles = (health: MilestoneHealth) => {
    switch (health) {
      case 'overdue':
        return {
          badge: 'bg-mc-accent-red/20 text-mc-accent-red border-mc-accent-red/30',
          bar: 'bg-mc-accent-red',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
        };
      case 'upcoming':
        return {
          badge: 'bg-mc-accent-yellow/20 text-mc-accent-yellow border-mc-accent-yellow/30',
          bar: 'bg-mc-accent-yellow',
          icon: <Clock className="w-3.5 h-3.5" />,
        };
      case 'on-track':
      default:
        return {
          badge: 'bg-mc-accent-green/20 text-mc-accent-green border-mc-accent-green/30',
          bar: 'bg-mc-accent-green',
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Blockether" width={40} height={40} priority className="mb-3 animate-pulse rounded" />
          <p className="text-mc-text-secondary">Loading milestones...</p>
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
              <h1 className="text-lg sm:text-xl font-semibold truncate">Milestones</h1>
              <p className="text-xs sm:text-sm text-mc-text-secondary truncate">{workspace.name}</p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Milestone</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {sortedMilestones.length === 0 ? (
          <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-12 text-center">
            <MilestoneIcon className="w-10 h-10 text-mc-border mx-auto mb-3" />
            <h3 className="font-medium mb-1">No milestones yet</h3>
            <p className="text-sm text-mc-text-secondary mb-4">Create your first milestone to track project goals</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              Create Milestone
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[19px] top-8 bottom-8 w-px bg-mc-border" />
            <div className="space-y-4">
              {sortedMilestones.map((milestone) => {
                const config = MILESTONE_STATUS_CONFIG[milestone.status];
                const health = getMilestoneHealth(milestone);
                const healthStyles = getHealthStyles(health);
                const milestoneTasks = getMilestoneTasks(milestone.id);
                const progress = getMilestoneProgress(milestone.id);
                const doneCount = milestoneTasks.filter((t) => t.status === 'done').length;

                return (
                  <div key={milestone.id} className="relative flex items-start gap-4">
                    <div className="relative z-10 shrink-0">
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${healthStyles.badge}`}>
                        {milestone.status === 'closed' ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          healthStyles.icon
                        )}
                      </div>
                    </div>

                    <div className="flex-1 bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                              {config.label}
                            </span>
                            {milestone.status === 'open' && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${healthStyles.badge}`}>
                                {health === 'overdue' && 'Overdue'}
                                {health === 'upcoming' && 'Due Soon'}
                                {health === 'on-track' && 'On Track'}
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold">{milestone.name}</h3>
                          {milestone.description && (
                            <p className="text-sm text-mc-text-secondary mt-1">{milestone.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-sm text-mc-text-secondary">
                        {milestone.due_date && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" />
                            <span>
                              {format(parseISO(milestone.due_date), 'MMM d, yyyy')}
                              {milestone.status === 'open' && (
                                <span className="ml-1 text-xs">
                                  ({differenceInDays(parseISO(milestone.due_date), new Date())} days)
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Target className="w-4 h-4" />
                          <span>{milestoneTasks.length} tasks</span>
                        </div>
                      </div>

                      {milestoneTasks.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-mc-text-secondary">{doneCount} of {milestoneTasks.length} completed</span>
                            <span className="font-medium">{progress}%</span>
                          </div>
                          <div className="h-2 bg-mc-bg rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${healthStyles.bar}`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateMilestoneModal
          workspaceId={workspace.id}
          onClose={() => setShowCreateModal(false)}
          onCreated={(newMilestone) => {
            setMilestones((prev) => [...prev, newMilestone]);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

function CreateMilestoneModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (milestone: Milestone) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      setError('Name is required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name,
          description: description || undefined,
          due_date: dueDate || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create milestone');
      }

      const newMilestone = await res.json();
      onCreated(newMilestone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create milestone');
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
          <h3 className="font-semibold">Create Milestone</h3>
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
            <label className="block text-sm font-medium mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., v1.0 Launch"
              className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the milestone goal..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-mc-border bg-mc-bg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-mc-accent/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/30"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 px-4 border border-mc-border rounded-lg text-sm font-medium hover:bg-mc-bg-tertiary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Milestone
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
