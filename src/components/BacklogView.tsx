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
  Plus,
  Flag,
  Calendar,
  Type,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Target,
  ListTodo,
  FunnelX,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useMissionControl } from '@/lib/store';
import type { Task, TaskType, TaskPriority, Milestone } from '@/lib/types';
import { TaskModal } from '@/components/TaskModal';
import { useTaskDeepLink } from '@/hooks/useTaskDeepLink';
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
  // Sprints state removed - backlog shows tasks without milestones
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<TaskType | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'all'>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'created' | 'title'>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [hideDone, setHideDone] = useState(true);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const { linkedTask, initialTab, openTask, closeTask, updateTab } = useTaskDeepLink();
  const activeEditingTask = editingTask || linkedTask;
  const handleTaskClick = (task: Task) => { setEditingTask(task); openTask(task); };
  const [assigningMilestone, setAssigningMilestone] = useState<string | null>(null);

  const getTaskAssigneePresentation = (task: Task): { badge: string; name: string | null } | null => {
    if (task.assignee_type === 'human') {
      const humanName = task.assigned_human?.name || task.assignee_display_name || null;
      return humanName ? { badge: 'HUMAN', name: humanName } : { badge: 'HUMAN', name: null };
    }

    if (task.assignee_type === 'ai' || task.assigned_agent_id) {
      return { badge: 'AI', name: null };
    }

    return null;
  };

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const milestonesRes = await fetch(`/api/milestones?workspace_id=${workspaceId}`);

        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
      } catch (error) {
        // Silent error handling
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [workspaceId]);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => !t.milestone_id);
    if (hideDone) {
      result = result.filter((t) => t.status !== 'done');
    }

    if (filterType !== 'all') {
      result = result.filter((t) => t.task_type === filterType);
    }

    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === filterPriority);
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
  }, [tasks, filterType, filterPriority, sortBy, sortDir, hideDone]);

  const backlogTasks = useMemo(() => tasks.filter((t) => !t.milestone_id), [tasks]);
  const urgentCount = useMemo(() => filteredTasks.filter((t) => t.priority === 'urgent').length, [filteredTasks]);
  const readyCount = useMemo(() => filteredTasks.filter((t) => t.status === 'assigned' || t.status === 'pending_dispatch').length, [filteredTasks]);
  const doneCount = useMemo(() => filteredTasks.filter((t) => t.status === 'done').length, [filteredTasks]);
  const activeFilterCount = (filterType !== 'all' ? 1 : 0) + (filterPriority !== 'all' ? 1 : 0);



  const getMilestoneName = (milestoneId: string | undefined): string => {
    if (!milestoneId) return 'No Milestone';
    const milestone = milestones.find((m) => m.id === milestoneId);
    return milestone?.name || 'Unknown Milestone';
  };

  const handleAssignMilestone = async (taskId: string, milestoneId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestone_id: milestoneId }),
      });
      if (res.ok) {
        setAssigningMilestone(null);
      }
    } catch (error) {
      // Silent error handling
    }
  };

  const toggleSort = (field: 'priority' | 'created' | 'title') => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const resetFilters = () => {
    setFilterType('all');
    setFilterPriority('all');
  };

  return (
    <div data-component="src/components/BacklogView" className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
            <ListTodo className="w-4 h-4 text-mc-accent" />
            <span>Backlog</span>
          </div>
          <p className="mt-1 text-xs text-mc-text-secondary">
            Unscheduled tasks waiting for milestone assignment and dispatch.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-mc-border bg-mc-bg text-mc-text-secondary">
            Total unscheduled: {backlogTasks.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-red-200 bg-red-50 text-red-700">
            Urgent: {urgentCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700">
            Ready: {readyCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-green-200 bg-green-50 text-green-700">
            Done in view: {doneCount}
          </span>
        </div>
      </div>

      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 border ${
              showFilters ? 'bg-mc-accent text-white border-mc-accent' : 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-mc-accent-green" />
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 border border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary"
            >
              <FunnelX className="w-4 h-4" />
              <span className="hidden sm:inline">Reset ({activeFilterCount})</span>
            </button>
          )}
          <button
            onClick={() => setHideDone(!hideDone)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 border ${
              hideDone ? 'border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary' : 'bg-mc-accent text-white border-mc-accent'
            }`}
          >
            {hideDone ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span className="hidden sm:inline">{hideDone ? 'Show Done' : 'Hide Done'}</span>
          </button>
          <div className="flex items-center bg-mc-bg-tertiary rounded-lg p-0.5">
            <button
              onClick={() => toggleSort('created')}
              title={`Sort by created (${sortBy === 'created' ? sortDir : 'desc'})`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                sortBy === 'created' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Created</span>
              {sortBy === 'created' && (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
            </button>
            <button
              onClick={() => toggleSort('priority')}
              title={`Sort by priority (${sortBy === 'priority' ? sortDir : 'desc'})`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                sortBy === 'priority' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Priority</span>
              {sortBy === 'priority' && (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
            </button>
            <button
              onClick={() => toggleSort('title')}
              title={`Sort by title (${sortBy === 'title' ? sortDir : 'desc'})`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                sortBy === 'title' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Title</span>
              {sortBy === 'title' && (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 min-h-9 bg-mc-accent text-white rounded-md text-sm font-medium hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showFilters && (
          <div className="p-3 border-b border-mc-border bg-mc-bg-secondary grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              <div className="flex items-end">
                <button
                  onClick={resetFilters}
                  className="w-full min-h-11 px-3 rounded-lg border border-mc-border bg-mc-bg text-sm text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          )}

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
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-mc-border bg-mc-bg-tertiary/50">
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
                    Milestone
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Assignee
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Created
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-mc-text-secondary uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mc-border">
                {filteredTasks.map((task) => {
                  const TypeIcon = TASK_TYPE_CONFIG[task.task_type].icon;
                  const typeColor = TASK_TYPE_CONFIG[task.task_type].color;
                  const assignee = getTaskAssigneePresentation(task);

                  return (
                    <tr
                      key={task.id}
                      onClick={() => handleTaskClick(task)}
                      className="cursor-pointer hover:bg-mc-bg-tertiary/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <TypeIcon className={`w-4 h-4 flex-shrink-0 ${typeColor}`} />
                          <span className="font-medium text-sm truncate max-w-[280px]">
                            {task.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-mc-bg-tertiary text-mc-text-secondary capitalize border border-mc-border">
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
                          {getMilestoneName(task.milestone_id)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {assignee ? (
                          <div className="flex items-center gap-1.5">
                            <AgentInitials name={assignee.badge} size="xs" />
                            <div className="min-w-0">
                              <span className="text-xs font-medium">{assignee.badge}</span>
                              {assignee.name ? (
                                <span className="block text-[11px] text-mc-text-secondary truncate max-w-[140px]">{assignee.name}</span>
                              ) : null}
                            </div>
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
                      <td className="px-4 py-3">
                        {assigningMilestone === task.id ? (
                          <div className="flex items-center gap-1.5 min-w-[200px]">
                            <select
                              autoFocus
                              onChange={(e) => handleAssignMilestone(task.id, e.target.value)}
                              className="flex-1 px-2 py-1 text-xs rounded border border-mc-border bg-mc-bg focus:outline-none focus:ring-2 focus:ring-mc-accent/50"
                            >
                              <option value="">Select milestone...</option>
                              {milestones.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => setAssigningMilestone(null)}
                              className="px-2 py-1 text-xs text-mc-text-secondary hover:text-mc-text"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAssigningMilestone(task.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-cyan-700 border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 transition-colors"
                          >
                            <Target className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Assign</span>
                          </button>
                        )}
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
      {activeEditingTask && (
        <TaskModal
          task={activeEditingTask}
          onClose={() => { setEditingTask(null); closeTask(); }}
          workspaceId={workspaceId}
          defaultTab={linkedTask ? initialTab : undefined}
          onTabChange={updateTab}
        />
      )}
    </div>
  );
}
