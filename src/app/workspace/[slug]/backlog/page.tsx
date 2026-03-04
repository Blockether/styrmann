'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Bug,
  Lightbulb,
  Wrench,
  BookOpen,
  FlaskConical,
  ChevronDown,
  Filter,
  ArrowRight,
  Circle,
  CircleDot,
  Calendar,
  User,
  Flag,
  Target,
} from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import type { Task, TaskType, TaskPriority, Workspace, Sprint, Milestone, Agent } from '@/lib/types';

const TASK_TYPE_CONFIG: Record<TaskType, { icon: React.ReactNode; color: string; bgColor: string }> = {
  bug: { icon: <Bug className="w-3.5 h-3.5" />, color: 'text-mc-accent-red', bgColor: 'bg-mc-accent-red/10' },
  feature: { icon: <Lightbulb className="w-3.5 h-3.5" />, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  chore: { icon: <Wrench className="w-3.5 h-3.5" />, color: 'text-mc-text-secondary', bgColor: 'bg-mc-bg-tertiary' },
  documentation: { icon: <BookOpen className="w-3.5 h-3.5" />, color: 'text-mc-accent-purple', bgColor: 'bg-mc-accent-purple/10' },
  research: { icon: <FlaskConical className="w-3.5 h-3.5" />, color: 'text-mc-accent-green', bgColor: 'bg-mc-accent-green/10' },
};

const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

export default function BacklogPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<TaskType | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'all'>('all');
  const [filterMilestone, setFilterMilestone] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'impact' | 'effort' | 'pareto'>('pareto');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [showSprintDropdown, setShowSprintDropdown] = useState(false);
  const [movingToSprint, setMovingToSprint] = useState(false);

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

        const [tasksRes, sprintsRes, milestonesRes, agentsRes] = await Promise.all([
          fetch(`/api/tasks?workspace_id=${ws.id}&backlog=true`),
          fetch(`/api/sprints?workspace_id=${ws.id}`),
          fetch(`/api/milestones?workspace_id=${ws.id}`),
          fetch(`/api/agents?workspace_id=${ws.id}`),
        ]);

        if (!mounted) return;

        if (tasksRes.ok) setTasks(await tasksRes.json());
        if (sprintsRes.ok) setSprints(await sprintsRes.json());
        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
      } catch (error) {
        console.error('Failed to load backlog data:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [slug]);

  const eligibleSprints = useMemo(() => {
    return sprints.filter((s) => s.status === 'planning' || s.status === 'active');
  }, [sprints]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (filterType !== 'all') {
      result = result.filter((t) => t.task_type === filterType);
    }
    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === filterPriority);
    }
    if (filterMilestone !== 'all') {
      result = result.filter((t) => t.milestone_id === filterMilestone);
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'priority') {
        cmp = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      } else if (sortBy === 'impact') {
        cmp = (a.impact || 0) - (b.impact || 0);
      } else if (sortBy === 'effort') {
        cmp = (a.effort || 0) - (b.effort || 0);
      } else {
        const scoreA = (a.impact || 0) / Math.max(a.effort || 1, 1);
        const scoreB = (b.impact || 0) / Math.max(b.effort || 1, 1);
        cmp = scoreA - scoreB;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [tasks, filterType, filterPriority, filterMilestone, sortBy, sortDir]);

  const toggleTask = (id: string) => {
    const next = new Set(selectedTasks);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedTasks(next);
  };

  const toggleAll = () => {
    if (selectedTasks.size === filteredTasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(filteredTasks.map((t) => t.id)));
    }
  };

  const moveToSprint = async (sprintId: string) => {
    if (selectedTasks.size === 0) return;
    setMovingToSprint(true);

    try {
      const updates = Array.from(selectedTasks).map((taskId) =>
        fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sprint_id: sprintId }),
        })
      );

      await Promise.all(updates);
      setTasks((prev) => prev.filter((t) => !selectedTasks.has(t.id)));
      setSelectedTasks(new Set());
    } catch (error) {
      console.error('Failed to move tasks:', error);
    } finally {
      setMovingToSprint(false);
      setShowSprintDropdown(false);
    }
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return '-';
    const agent = agents.find((a) => a.id === agentId);
    return agent?.name || '-';
  };

  const getMilestoneName = (milestoneId: string | undefined) => {
    if (!milestoneId) return '-';
    const milestone = milestones.find((m) => m.id === milestoneId);
    return milestone?.name || '-';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="Blockether" width={40} height={40} priority className="mb-3 animate-pulse rounded" />
          <p className="text-mc-text-secondary">Loading backlog...</p>
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
              <h1 className="text-lg sm:text-xl font-semibold truncate">Backlog</h1>
              <p className="text-xs sm:text-sm text-mc-text-secondary truncate">{workspace.name}</p>
            </div>
          </div>

          {selectedTasks.size > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowSprintDropdown(!showSprintDropdown)}
                disabled={movingToSprint}
                className="flex items-center gap-2 min-h-11 px-4 bg-mc-accent text-white rounded-lg text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                <ArrowRight className="w-4 h-4" />
                Move to Sprint ({selectedTasks.size})
                <ChevronDown className="w-4 h-4" />
              </button>

              {showSprintDropdown && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-10 py-1">
                  {eligibleSprints.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-mc-text-secondary">No active or planning sprints</div>
                  ) : (
                    eligibleSprints.map((sprint) => (
                      <button
                        key={sprint.id}
                        onClick={() => moveToSprint(sprint.id)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-mc-bg-tertiary flex items-center gap-2"
                      >
                        <span className="truncate">{sprint.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${sprint.status === 'active' ? 'bg-mc-accent-green/20 text-mc-accent-green' : 'bg-mc-accent-yellow/20 text-mc-accent-yellow'}`}>
                          {sprint.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <section className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-mc-text-secondary" />

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as TaskType | 'all')}
              className="min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
            >
              <option value="all">All Types</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="chore">Chore</option>
              <option value="documentation">Documentation</option>
              <option value="research">Research</option>
            </select>

            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as TaskPriority | 'all')}
              className="min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>

            <select
              value={filterMilestone}
              onChange={(e) => setFilterMilestone(e.target.value)}
              className="min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
            >
              <option value="all">All Milestones</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            <select
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [by, dir] = e.target.value.split(':');
                setSortBy(by as typeof sortBy);
                setSortDir(dir as typeof sortDir);
              }}
              className="min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm"
            >
              <option value="pareto:desc">Pareto Score (High to Low)</option>
              <option value="pareto:asc">Pareto Score (Low to High)</option>
              <option value="priority:asc">Priority (High to Low)</option>
              <option value="priority:desc">Priority (Low to High)</option>
              <option value="impact:desc">Impact (High to Low)</option>
              <option value="impact:asc">Impact (Low to High)</option>
              <option value="effort:asc">Effort (Low to High)</option>
              <option value="effort:desc">Effort (High to Low)</option>
            </select>
          </div>
        </section>

        <section className="bg-mc-bg-secondary border border-mc-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-mc-bg-tertiary border-b border-mc-border">
                <tr>
                  <th className="w-10 px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedTasks.size === filteredTasks.length && filteredTasks.length > 0}
                      onChange={toggleAll}
                      className="rounded border-mc-border"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Type</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Title</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Priority</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Impact</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Effort</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Pareto</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Assignee</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Milestone</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase text-mc-text-secondary">Due</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-mc-text-secondary">
                      <div className="flex flex-col items-center gap-2">
                        <Target className="w-8 h-8 text-mc-border" />
                        <p>No tasks in backlog</p>
                        <p className="text-sm">Tasks not assigned to a sprint will appear here</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task) => {
                    const typeConfig = TASK_TYPE_CONFIG[task.task_type];
                    const paretoScore = (task.impact || 0) / Math.max(task.effort || 1, 1);

                    return (
                      <tr
                        key={task.id}
                        className={`border-b border-mc-border/50 hover:bg-mc-bg-tertiary/30 ${
                          selectedTasks.has(task.id) ? 'bg-mc-accent/5' : ''
                        }`}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedTasks.has(task.id)}
                            onChange={() => toggleTask(task.id)}
                            className="rounded border-mc-border"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded ${typeConfig.bgColor} ${typeConfig.color}`}>
                            {typeConfig.icon}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-medium text-sm line-clamp-1">{task.title}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <Flag className={`w-3.5 h-3.5 ${
                              task.priority === 'urgent' ? 'text-mc-accent-red' :
                              task.priority === 'high' ? 'text-mc-accent-yellow' :
                              task.priority === 'normal' ? 'text-mc-accent' : 'text-mc-text-secondary'
                            }`} />
                            <span className="text-sm capitalize">{task.priority}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <EffortImpactDots value={task.impact} />
                        </td>
                        <td className="px-3 py-3">
                          <EffortImpactDots value={task.effort} />
                        </td>
                        <td className="px-3 py-3">
                          <span className={`text-sm font-medium ${paretoScore >= 1 ? 'text-mc-accent-green' : paretoScore >= 0.5 ? 'text-mc-accent' : 'text-mc-text-secondary'}`}>
                            {paretoScore.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm capitalize text-mc-text-secondary">{task.status.replace('_', ' ')}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm text-mc-text-secondary">{getAgentName(task.assigned_agent_id)}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm text-mc-text-secondary">{getMilestoneName(task.milestone_id)}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-sm text-mc-text-secondary">
                            {task.due_date ? format(parseISO(task.due_date), 'MMM d') : '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function EffortImpactDots({ value }: { value?: number }) {
  const val = value ?? 0;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        i <= val ? (
          <CircleDot key={i} className="w-3 h-3 text-mc-accent" />
        ) : (
          <Circle key={i} className="w-3 h-3 text-mc-border" />
        )
      ))}
    </div>
  );
}
