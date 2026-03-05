'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Bug,
  Lightbulb,
  Wrench,
  BookOpen,
  FlaskConical,
  Filter,
  Circle,
  CircleDot,
  Flag,
  ArrowUpDown,
  Loader2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useMissionControl } from '@/lib/store';
import type { Task, TaskType, TaskPriority, Sprint, Milestone, Agent } from '@/lib/types';
import { TaskModal } from '@/components/TaskModal';
import { AgentInitials } from '@/components/AgentInitials';

const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low'];

const TASK_TYPE_CONFIG: Record<TaskType, { icon: typeof Bug; color: string }> = {
  bug: { icon: Bug, color: 'text-red-500' },
  feature: { icon: Lightbulb, color: 'text-yellow-500' },
  chore: { icon: Wrench, color: 'text-blue-500' },
  documentation: { icon: BookOpen, color: 'text-green-500' },
  research: { icon: FlaskConical, color: 'text-purple-500' },
};

interface BacklogViewProps {
  workspaceId: string;
}

export function BacklogView({ workspaceId }: BacklogViewProps) {
  const { tasks } = useMissionControl();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterSprint, setFilterSprint] = useState<string>('all');
  const [filterType, setFilterType] = useState<TaskType | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'all'>('all');
  const [filterMilestone, setFilterMilestone] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'created' | 'title'>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [sprintsRes, milestonesRes, agentsRes] = await Promise.all([
          fetch(`/api/sprints?workspace_id=${workspaceId}`),
          fetch(`/api/milestones?workspace_id=${workspaceId}`),
          fetch(`/api/agents?workspace_id=${workspaceId}`),
        ]);

        if (sprintsRes.ok) setSprints(await sprintsRes.json());
        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
      } catch (error) {
        console.error('Failed to load backlog data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [workspaceId]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (filterSprint === 'none') {
      result = result.filter((t) => !t.sprint_id);
    } else if (filterSprint !== 'all') {
      result = result.filter((t) => t.sprint_id === filterSprint);
    }

    if (filterType !== 'all') {
      result = result.filter((t) => t.task_type === filterType);
    }

    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === filterPriority);
    }

    if (filterMilestone === 'none') {
      result = result.filter((t) => !t.milestone_id);
    } else if (filterMilestone !== 'all') {
      result = result.filter((t) => t.milestone_id === filterMilestone);
    }

    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'priority') {
        comparison = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      } else if (sortBy === 'created') {
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortBy === 'title') {
        comparison = a.title.localeCompare(b.title);
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [tasks, filterSprint, filterType, filterPriority, filterMilestone, sortBy, sortDir]);

  const getSprintName = (sprintId: string | undefined): string => {
    if (!sprintId) return 'No Sprint';
    const sprint = sprints.find((s) => s.id === sprintId);
    return sprint?.name || 'Unknown Sprint';
  };

  const getMilestoneName = (milestoneId: string | undefined): string => {
    if (!milestoneId) return 'No Milestone';
    const milestone = milestones.find((m) => m.id === milestoneId);
    return milestone?.name || 'Unknown Milestone';
  };

  const getAgent = (agentId: string | null | undefined): Agent | undefined => {
    if (!agentId) return undefined;
    return agents.find((a) => a.id === agentId);
  };

  const toggleSort = (field: 'priority' | 'created' | 'title') => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-mc-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Backlog</h2>
          <span className="text-sm text-mc-text-secondary">{filteredTasks.length} tasks</span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90"
        >
          <CircleDot className="w-4 h-4" />
          New Task
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="bg-mc-bg-secondary border-b border-mc-border">
          <div className="p-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                showFilters ? 'bg-mc-accent text-white border-mc-accent' : 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {(filterSprint !== 'all' || filterType !== 'all' || filterPriority !== 'all' || filterMilestone !== 'all') && (
                <span className="w-2 h-2 rounded-full bg-mc-accent-green" />
              )}
            </button>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-mc-text-secondary">Sort:</span>
              <button
                onClick={() => toggleSort('created')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                  sortBy === 'created' ? 'bg-mc-accent text-white' : 'bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                Created
              </button>
              <button
                onClick={() => toggleSort('priority')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                  sortBy === 'priority' ? 'bg-mc-accent text-white' : 'bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                Priority
              </button>
              <button
                onClick={() => toggleSort('title')}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                  sortBy === 'title' ? 'bg-mc-accent text-white' : 'bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                Title
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="p-4 border-t border-mc-border bg-mc-bg-tertiary/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-mc-text-secondary mb-1.5">Sprint</label>
                <select
                  value={filterSprint}
                  onChange={(e) => setFilterSprint(e.target.value)}
                  className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                >
                  <option value="all">All Sprints</option>
                  <option value="none">No Sprint (Backlog)</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1.5">Type</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as TaskType | 'all')}
                  className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                >
                  <option value="all">All Types</option>
                  <option value="bug">Bug</option>
                  <option value="feature">Feature</option>
                  <option value="chore">Chore</option>
                  <option value="documentation">Documentation</option>
                  <option value="research">Research</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1.5">Priority</label>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value as TaskPriority | 'all')}
                  className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                >
                  <option value="all">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1.5">Milestone</label>
                <select
                  value={filterMilestone}
                  onChange={(e) => setFilterMilestone(e.target.value)}
                  className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                >
                  <option value="all">All Milestones</option>
                  <option value="none">No Milestone</option>
                  {milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-mc-text-secondary" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-12 text-center">
            <Circle className="w-12 h-12 text-mc-border mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Tasks Found</h3>
            <p className="text-sm text-mc-text-secondary mb-4">
              {tasks.length === 0
                ? 'Create your first task to get started.'
                : 'No tasks match the current filters.'}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90"
            >
              <CircleDot className="w-4 h-4" />
              New Task
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-mc-border bg-mc-bg-tertiary/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Task
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Sprint
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Milestone
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Assignee
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mc-border">
                {filteredTasks.map((task) => {
                  const TypeIcon = TASK_TYPE_CONFIG[task.task_type].icon;
                  const typeColor = TASK_TYPE_CONFIG[task.task_type].color;
                  const assignee = getAgent(task.assigned_agent_id);

                  return (
                    <tr
                      key={task.id}
                      onClick={() => setEditingTask(task)}
                      className="cursor-pointer hover:bg-mc-bg-tertiary/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <TypeIcon className={`w-4 h-4 flex-shrink-0 ${typeColor}`} />
                          <span className="font-medium text-sm truncate max-w-[200px]">
                            {task.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-mc-bg-tertiary text-mc-text-secondary capitalize">
                          {task.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Flag
                            className={`w-3.5 h-3.5 ${
                              task.priority === 'urgent'
                                ? 'text-mc-accent-red'
                                : task.priority === 'high'
                                ? 'text-mc-accent-yellow'
                                : 'text-mc-text-secondary'
                            }`}
                          />
                          <span className="text-xs capitalize">{task.priority}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-mc-text-secondary truncate max-w-[120px] block">
                          {getSprintName(task.sprint_id)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-mc-text-secondary truncate max-w-[120px] block">
                          {getMilestoneName(task.milestone_id)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {assignee ? (
                          <div className="flex items-center gap-1.5">
                            <AgentInitials name={assignee.name} size="xs" />
                            <span className="text-xs truncate max-w-[100px]">{assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-mc-text-secondary">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-mc-text-secondary">
                          {format(parseISO(task.created_at), 'MMM d, yyyy')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <TaskModal
          onClose={() => setShowCreateModal(false)}
          workspaceId={workspaceId}
        />
      )}
      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
