'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronDown, CheckCircle2, Loader2, Flag, Calendar, ChevronRight, ArrowRightLeft, LayoutList, Columns3, GripVertical, Target, AlertCircle, Crown, Bug, Lightbulb, Wrench, BookOpen, FlaskConical } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskStatus, TaskType, Sprint, Milestone, Agent } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { CreateMilestoneModal } from './CreateMilestoneModal';
import { AgentInitials } from './AgentInitials';
import { formatDistanceToNow } from 'date-fns';
import { useTaskDeepLink } from '@/hooks/useTaskDeepLink';

interface ActiveSprintProps {
  workspaceId?: string;
  mobileMode?: boolean;
  isPortrait?: boolean;
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'bg-mc-accent-purple' },
  pending_dispatch: { label: 'Pending', color: 'bg-gray-400' },
  inbox: { label: 'Inbox', color: 'bg-mc-accent-pink' },
  assigned: { label: 'Assigned', color: 'bg-mc-accent-yellow' },
  in_progress: { label: 'In Progress', color: 'bg-mc-accent' },
  testing: { label: 'Testing', color: 'bg-mc-accent-cyan' },
  review: { label: 'Review', color: 'bg-mc-accent-purple' },
  verification: { label: 'Verification', color: 'bg-orange-500' },
  done: { label: 'Done', color: 'bg-mc-accent-green' },
};

const BOARD_COLUMN_CONFIG: { status: TaskStatus; borderColor: string }[] = [
  { status: 'planning', borderColor: 'border-t-purple-600' },
  { status: 'inbox', borderColor: 'border-t-pink-500' },
  { status: 'assigned', borderColor: 'border-t-yellow-500' },
  { status: 'in_progress', borderColor: 'border-t-mc-accent' },
  { status: 'testing', borderColor: 'border-t-cyan-500' },
  { status: 'review', borderColor: 'border-t-purple-600' },
  { status: 'verification', borderColor: 'border-t-orange-500' },
  { status: 'done', borderColor: 'border-t-green-500' },
];

const DONE_STATUSES: TaskStatus[] = ['done'];

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  normal: 'bg-blue-500',
  low: 'bg-gray-400',
};

const TASK_TYPE_CONFIG: Record<TaskType, { icon: typeof Bug; color: string }> = {
  bug: { icon: Bug, color: 'text-red-500' },
  feature: { icon: Lightbulb, color: 'text-yellow-500' },
  chore: { icon: Wrench, color: 'text-blue-500' },
  documentation: { icon: BookOpen, color: 'text-green-500' },
  research: { icon: FlaskConical, color: 'text-purple-500' },
};

function getTaskAssigneePresentation(task: Task): { badge: string; name: string | null } | null {
  if (task.assignee_type === 'human') {
    const humanName = task.assigned_human?.name || task.assignee_display_name || null;
    return humanName ? { badge: 'HUMAN', name: humanName } : { badge: 'HUMAN', name: null };
  }

  if (task.assignee_type === 'ai' || task.assigned_agent_id) {
    return { badge: 'AI', name: null };
  }

  return null;
}

export function ActiveSprint({ workspaceId, mobileMode = false, isPortrait = true }: ActiveSprintProps) {
  const { tasks: storeTasks, updateTaskStatus, addEvent, selectedSprintId: storeSelectedSprintId, setSelectedSprintId: setStoreSelectedSprintId } = useMissionControl();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSprintDropdown, setShowSprintDropdown] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTaskMilestoneId, setCreateTaskMilestoneId] = useState<string | undefined>(undefined);
  const [showCreateMilestoneModal, setShowCreateMilestoneModal] = useState(false);
  const { linkedTask, initialTab, openTask, closeTask, updateTab } = useTaskDeepLink();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const activeEditingTask = editingTask || linkedTask;
  const handleTaskClick = (task: Task) => { setEditingTask(task); openTask(task); };
  const [endingSprint, setEndingSprint] = useState(false);
  const [creatingSprint, setCreatingSprint] = useState(false);
  const [statusMoveTask, setStatusMoveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [selectedBoardStatus, setSelectedBoardStatus] = useState<TaskStatus>('planning');
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [expandedMilestones, setExpandedMilestones] = useState<Set<string>>(new Set());

  const openCreateTaskModal = (milestoneId?: string) => {
    setCreateTaskMilestoneId(milestoneId);
    setShowCreateModal(true);
  };

  // Sync store-selected sprint to local state (from sidebar history navigation)
  useEffect(() => {
    if (storeSelectedSprintId) {
      setSelectedSprintId(storeSelectedSprintId);
      setStoreSelectedSprintId(null);
    }
  }, [storeSelectedSprintId, setStoreSelectedSprintId]);

  // Initial data load (sprints + agents only)
  useEffect(() => {
    if (!workspaceId) return;

    async function loadData() {
      try {
        setLoading(true);
        const [sprintsRes, agentsRes] = await Promise.all([
          fetch(`/api/sprints?workspace_id=${workspaceId}`),
          fetch(`/api/agents?workspace_id=${workspaceId}`),
        ]);

        if (sprintsRes.ok) {
          const sprintsData: Sprint[] = await sprintsRes.json();
          setSprints(sprintsData);

          const activeSprint = sprintsData.find((s) => s.status === 'active');
          const planningSprint = sprintsData.find((s) => s.status === 'planning');
          setSelectedSprintId(activeSprint?.id || planningSprint?.id || null);
        }

        if (agentsRes.ok) setAgents(await agentsRes.json());
      } catch (error) {
        console.error('Failed to load sprint data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [workspaceId]);

  // Fetch milestones when sprint selection changes
  useEffect(() => {
    if (!workspaceId) return;

    async function loadMilestones() {
      try {
        const url = selectedSprintId
          ? `/api/milestones?workspace_id=${workspaceId}&sprint_id=${selectedSprintId}`
          : `/api/milestones?workspace_id=${workspaceId}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setMilestones(data);
          // Expand all milestones by default
          setExpandedMilestones(new Set(data.map((m: Milestone) => m.id)));
        }
      } catch (error) {
        console.error('Failed to load milestones:', error);
      }
    }

    loadMilestones();
  }, [workspaceId, selectedSprintId]);

  const sprintTasks = useMemo(() => {
    if (!selectedSprintId) return [];
    const sprintMilestoneIds = new Set(milestones.map((m) => m.id));
    return storeTasks.filter((t) =>{
      if (t.milestone_id) return sprintMilestoneIds.has(t.milestone_id);
      // Ungrouped tasks: no milestone, belong to workspace
      return t.workspace_id === workspaceId;
    });
  }, [storeTasks, selectedSprintId, milestones, workspaceId]);

  const tasksByMilestone = useMemo(() => {
    const groups: Record<string, Task[]> = { ungrouped: [] };

    sprintTasks.forEach((task) => {
      if (task.milestone_id) {
        if (!groups[task.milestone_id]) {
          groups[task.milestone_id] = [];
        }
        groups[task.milestone_id].push(task);
      } else {
        groups['ungrouped'].push(task);
      }
    });

    return groups;
  }, [sprintTasks]);

  const milestoneOrder = useMemo(() => {
    return milestones
      .sort((a, b) => {
        const orderA = PRIORITY_ORDER[a.priority || 'normal'] ?? 2;
        const orderB = PRIORITY_ORDER[b.priority || 'normal'] ?? 2;
        return orderA - orderB;
      })
      .map((m) => m.id);
  }, [milestones]);

  const hasUngrouped = tasksByMilestone['ungrouped'].length > 0;

  const selectedSprint = sprints.find((s) => s.id === selectedSprintId);
  const activeSprint = sprints.find((s) => s.status === 'active');
  const completedSprintTasks = sprintTasks.filter((task) => DONE_STATUSES.includes(task.status)).length;
  const completionPercent = sprintTasks.length > 0 ? Math.round((completedSprintTasks / sprintTasks.length) * 100) : 0;
  const blockedSprintTasks = sprintTasks.filter((task) => Boolean(task.planning_dispatch_error)).length;

  const updateTaskStatusWithPersist = async (task: Task, targetStatus: TaskStatus) => {
    if (task.status === targetStatus) return;

    updateTaskStatus(task.id, targetStatus);

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        addEvent({
          id: task.id + '-' + Date.now(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: task.id,
          message: `Task "${task.title}" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });

        if (shouldTriggerAutoDispatch(task.status, targetStatus, task.assigned_agent_id)) {
          const result = await triggerAutoDispatch({
            taskId: task.id,
            taskTitle: task.title,
            agentId: task.assigned_agent_id,
            agentName: task.assigned_agent?.name || 'Unknown Agent',
            workspaceId: task.workspace_id,
          });

          if (!result.success) {
            console.error('Auto-dispatch failed:', result.error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      updateTaskStatus(task.id, task.status);
    }
  };

  const handleEndSprint = async () => {
    if (!selectedSprintId) return;
    setEndingSprint(true);
    try {
      const res = await fetch(`/api/sprints/${selectedSprintId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      if (res.ok) {
        setSprints((prev) =>
          prev.map((s) => (s.id === selectedSprintId ? { ...s, status: 'completed' } : s))
        );
        const remaining = sprints.filter((s) => s.status === 'planning' || s.status === 'active');
        setSelectedSprintId(remaining[0]?.id || null);
      }
    } catch (error) {
      console.error('Failed to end sprint:', error);
    } finally {
      setEndingSprint(false);
    }
  };

  const handleCreateNextSprint = async () => {
    if (!workspaceId) return;
    setCreatingSprint(true);
    try {
      const now = new Date();
      const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          start_date: now.toISOString().split('T')[0],
          end_date: twoWeeksLater.toISOString().split('T')[0],
        }),
      });

      if (res.ok) {
        const newSprint = await res.json();
        setSprints((prev) => [...prev, newSprint]);
        setSelectedSprintId(newSprint.id);
      }
    } catch (error) {
      console.error('Failed to create sprint:', error);
    } finally {
      setCreatingSprint(false);
    }
  };

  const getMilestoneProgress = (milestoneId: string) => {
    const tasks = tasksByMilestone[milestoneId] || [];
    const done = tasks.filter((t) => DONE_STATUSES.includes(t.status)).length;
    return { done, total: tasks.length };
  };

  const getMilestoneCoordinator = (milestoneId: string) => {
    const milestone = milestones.find((m) => m.id === milestoneId);
    if (!milestone?.coordinator_agent_id) return null;
    return agents.find((a) => a.id === milestone.coordinator_agent_id) || null;
  };

  const toggleMilestone = (milestoneId: string) => {
    setExpandedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(milestoneId)) {
        next.delete(milestoneId);
      } else {
        next.add(milestoneId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-mc-text-secondary" />
      </div>
    );
  }

  if (sprints.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <Calendar className="w-12 h-12 text-mc-border mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Sprints Yet</h3>
        <p className="text-sm text-mc-text-secondary text-center mb-4">
          Create your first sprint to start organizing tasks.
        </p>
        <button
          onClick={handleCreateNextSprint}
          disabled={creatingSprint}
          className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          {creatingSprint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create First Sprint
        </button>
      </div>
    );
  }

  if (!selectedSprintId || !selectedSprint) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <Flag className="w-12 h-12 text-mc-border mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Active Sprint</h3>
        <p className="text-sm text-mc-text-secondary text-center mb-4">
          Select a sprint from the dropdown or create a new one.
        </p>
        <button
          onClick={handleCreateNextSprint}
          disabled={creatingSprint}
          className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
        >
          {creatingSprint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create Sprint
        </button>
      </div>
    );
  }

  return (
    <div data-component="src/components/ActiveSprint" className="flex-1 flex flex-col overflow-hidden">
      <div className={`p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 ${mobileMode && isPortrait ? 'flex-wrap' : ''}`}>
        <div className="flex items-center gap-2">
          <h2 className="sr-only">{activeSprint?.name || 'Sprint'}</h2>
          
          <div className="relative">
            <button
              onClick={() => setShowSprintDropdown(!showSprintDropdown)}
              aria-label="Select sprint"
              className="flex items-center gap-2 px-3 min-h-11 rounded-lg border border-mc-border bg-mc-bg-secondary text-sm font-medium hover:bg-mc-bg-tertiary"
            >
              <span className={selectedSprint.status === 'active' ? 'text-mc-accent-green' : 'text-mc-text-secondary'}>
                {selectedSprint.name}
              </span>
              {selectedSprint.status === 'active' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-mc-accent-green/20 text-mc-accent-green">Active</span>
              )}
              <ChevronDown className="w-4 h-4 text-mc-text-secondary" />
            </button>

            {showSprintDropdown && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-mc-bg-secondary border border-mc-border rounded-lg shadow-lg z-20 py-1">
                {[...sprints.filter((s) => s.status === 'active' || s.status === 'planning'), ...sprints.filter((s) => s.status === 'completed')].map((sprint) => (
                  <button
                    key={sprint.id}
                    onClick={() => {
                      setSelectedSprintId(sprint.id);
                      setShowSprintDropdown(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-mc-bg-tertiary flex items-center justify-between ${
                      selectedSprintId === sprint.id ? 'bg-mc-bg-tertiary' : ''
                    }`}
                  >
                    <span>{sprint.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      sprint.status === 'active' ? 'bg-mc-accent-green/20 text-mc-accent-green' :
                      sprint.status === 'planning' ? 'bg-mc-accent-yellow/20 text-mc-accent-yellow' :
                      'bg-mc-bg-tertiary text-mc-text-secondary'
                    }`}>
                      {sprint.status}
                    </span>
                  </button>
                ))}
                <div className="border-t border-mc-border mt-1 pt-1">
                  <button
                    onClick={() => {
                      handleCreateNextSprint();
                      setShowSprintDropdown(false);
                    }}
                    disabled={creatingSprint}
                    className="w-full px-3 py-2 text-left text-sm text-mc-accent hover:bg-mc-bg-tertiary flex items-center gap-2"
                  >
                    {creatingSprint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Next Sprint
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-mc-bg-tertiary rounded-lg p-0.5" role="tablist" aria-label="View mode">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List view"
              role="tab"
              aria-selected={viewMode === 'list'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                viewMode === 'list' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              <LayoutList className="w-4 h-4" />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              onClick={() => setViewMode('board')}
              aria-label="Board view"
              role="tab"
              aria-selected={viewMode === 'board'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                viewMode === 'board' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              <Columns3 className="w-4 h-4" />
              <span className="hidden sm:inline">Board</span>
            </button>
          </div>
          {selectedSprint.status === 'active' && (
            <button
              onClick={handleEndSprint}
              disabled={endingSprint}
              className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary disabled:opacity-50"
            >
              {endingSprint ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span className="hidden sm:inline">End Sprint</span>
            </button>
          )}
          <button
            onClick={() => setShowCreateMilestoneModal(true)}
            aria-label="Create new milestone"
            className="flex items-center gap-2 px-3 min-h-11 border border-mc-border rounded text-sm text-mc-text-secondary hover:bg-mc-bg-tertiary"
          >
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">New Milestone</span>
          </button>
          <button
            onClick={() => openCreateTaskModal(undefined)}
            aria-label="Create new task"
            className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="p-2.5 rounded-lg border border-mc-border bg-mc-bg">
            <div className="text-mc-text-secondary">Milestones</div>
            <div className="text-mc-text font-semibold mt-0.5">{milestones.length}</div>
          </div>
          <div className="p-2.5 rounded-lg border border-mc-border bg-mc-bg">
            <div className="text-mc-text-secondary">Tasks</div>
            <div className="text-mc-text font-semibold mt-0.5">{sprintTasks.length}</div>
          </div>
          <div className="p-2.5 rounded-lg border border-green-200 bg-green-50">
            <div className="text-green-700">Completed</div>
            <div className="text-green-700 font-semibold mt-0.5">{completedSprintTasks} ({completionPercent}%)</div>
          </div>
          <div className="p-2.5 rounded-lg border border-red-200 bg-red-50">
            <div className="text-red-700">Blocked</div>
            <div className="text-red-700 font-semibold mt-0.5">{blockedSprintTasks}</div>
          </div>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${viewMode === 'board' ? 'overflow-hidden' : ''} ${isPortrait && viewMode === 'list' ? 'p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]' : viewMode === 'list' ? 'p-3' : ''}`}>
        {viewMode === 'list' && sprintTasks.length === 0 && milestoneOrder.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
              <Flag className="w-6 h-6 text-mc-text-secondary" />
            </div>
            <h3 className="text-base font-medium mb-1">No Tasks in This Sprint</h3>
            <p className="text-sm text-mc-text-secondary">Use the New Task button above to add tasks.</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className={`space-y-6 ${isPortrait ? '' : 'space-y-4'}`}>
            {milestoneOrder.map((milestoneId) => {
              const milestone = milestones.find((m) => m.id === milestoneId);
              const tasks = tasksByMilestone[milestoneId] || [];
              const { done, total } = getMilestoneProgress(milestoneId);
              const coordinator = getMilestoneCoordinator(milestoneId);
              const progress = total > 0 ? (done / total) * 100 : 0;
              const isExpanded = expandedMilestones.has(milestoneId);

              return (
                <MilestoneGroup
                  key={milestoneId}
                  milestone={milestone ?? null}
                  coordinator={coordinator ?? null}
                  tasks={tasks}
                  done={done}
                  total={total}
                  progress={progress}
                  isPortrait={isPortrait}
                  isExpanded={isExpanded}
                  onToggle={() => toggleMilestone(milestoneId)}
                  onTaskClick={handleTaskClick}
                  onMoveStatus={setStatusMoveTask}
                  onCreateTask={openCreateTaskModal}
                  mobileMode={mobileMode}
                />
              );
            })}

            {hasUngrouped && (
              <MilestoneGroup
                milestone={null}
                coordinator={null}
                tasks={tasksByMilestone['ungrouped']}
                done={tasksByMilestone['ungrouped'].filter((t) => DONE_STATUSES.includes(t.status)).length}
                total={tasksByMilestone['ungrouped'].length}
                progress={tasksByMilestone['ungrouped'].length > 0 ? (tasksByMilestone['ungrouped'].filter((t) => DONE_STATUSES.includes(t.status)).length / tasksByMilestone['ungrouped'].length) * 100 : 0}
                isPortrait={isPortrait}
                isExpanded={expandedMilestones.has('ungrouped')}
                onToggle={() => toggleMilestone('ungrouped')}
                onTaskClick={handleTaskClick}
                onMoveStatus={setStatusMoveTask}
                onCreateTask={openCreateTaskModal}
                mobileMode={mobileMode}
              />
            )}
          </div>
        ) : mobileMode ? (
          <div className="flex flex-col h-full">
            <div className="flex gap-2 p-3 overflow-x-auto border-b border-mc-border flex-shrink-0">
              {BOARD_COLUMN_CONFIG.map(({ status }) => {
                const count = sprintTasks.filter((t) => t.status === status).length;
                const config = STATUS_CONFIG[status];
                const isSelected = selectedBoardStatus === status;
                return (
                  <button
                    key={status}
                    onClick={() => setSelectedBoardStatus(status)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap min-h-8 transition-colors ${
                      isSelected
                        ? 'bg-mc-accent text-white'
                        : 'bg-mc-bg-secondary border border-mc-border text-mc-text-secondary hover:text-mc-text'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${config.color}`} />
                    {config.label}
                    <span className={`text-xs ${isSelected ? 'text-white/70' : 'text-mc-text-secondary'}`}>({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sprintTasks
                .filter((t) => t.status === selectedBoardStatus)
                .map((task) => (
                  (() => {
                    const assignee = getTaskAssigneePresentation(task);
                    return (
                  <div
                    key={task.id}
                    onClick={() => handleTaskClick(task)}
                    className="bg-mc-bg-secondary border border-mc-border/50 rounded-lg p-3 cursor-pointer hover:border-mc-accent/40 transition-colors"
                  >
                    <div className="flex items-start gap-2 mb-2">
                      {(() => { const TI = TASK_TYPE_CONFIG[task.task_type]; return TI ? <TI.icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${TI.color}`} /> : <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STATUS_CONFIG[task.status].color}`} />; })()}
                      <h4 className="font-medium text-sm line-clamp-2 flex-1">{task.title}</h4>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-mc-text-secondary mb-3">
                      {assignee && (
                        <div className="flex items-center gap-1.5">
                          <AgentInitials name={assignee.badge} size="xs" />
                          <span className="font-medium">{assignee.badge}</span>
                          {assignee.name ? <span className="truncate">{assignee.name}</span> : null}
                        </div>
                      )}
                      <span className="capitalize">{task.priority}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatusMoveTask(task);
                      }}
                      className="w-full min-h-11 rounded-md border border-mc-border bg-mc-bg flex items-center justify-center gap-2 text-mc-text-secondary text-sm hover:bg-mc-bg-tertiary transition-colors"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      Move Status
                    </button>
                  </div>
                    );
                  })()
                ))}
              {sprintTasks.filter((t) => t.status === selectedBoardStatus).length === 0 && (
                <div className="text-center py-8 text-mc-text-secondary text-sm">
                  No tasks in {STATUS_CONFIG[selectedBoardStatus].label}
                </div>
              )}
            </div>
          </div>
        ) : (
          <MilestoneBoard
            milestoneOrder={milestoneOrder}
            milestones={milestones}
            tasksByMilestone={tasksByMilestone}
            hasUngrouped={hasUngrouped}
            agents={agents}
            onTaskClick={handleTaskClick}
            draggedTask={draggedTask}
            setDraggedTask={setDraggedTask}
            updateTaskStatusWithPersist={updateTaskStatusWithPersist}
          />
        )}
      </div>

      {showCreateModal && (
        <TaskModal
          onClose={() => {
            setShowCreateModal(false);
            setCreateTaskMilestoneId(undefined);
          }}
          workspaceId={workspaceId}
          defaultSprintId={selectedSprintId || undefined}
          defaultMilestoneId={createTaskMilestoneId}
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

      {showCreateMilestoneModal && workspaceId && (
        <CreateMilestoneModal
          workspaceId={workspaceId}
          sprintId={selectedSprintId || undefined}
          agents={agents}
          onClose={() => setShowCreateMilestoneModal(false)}
          onCreated={() => {
            const url = selectedSprintId
              ? `/api/milestones?workspace_id=${workspaceId}&sprint_id=${selectedSprintId}`
              : `/api/milestones?workspace_id=${workspaceId}`;
            fetch(url).then(r => r.json()).then(data => {
              setMilestones(data);
              setExpandedMilestones(new Set(data.map((m: Milestone) => m.id)));
            }).catch(() => {});
          }}
        />
      )}
      {mobileMode && statusMoveTask && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-end sm:items-center sm:justify-center" onClick={() => setStatusMoveTask(null)}>
          <div
            className="w-full sm:max-w-md bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm text-mc-text-secondary mb-2">Move task</div>
            <div className="font-medium mb-4 line-clamp-2">{statusMoveTask.title}</div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <button
                  key={status}
                  onClick={async () => {
                    await updateTaskStatusWithPersist(statusMoveTask, status as TaskStatus);
                    setStatusMoveTask(null);
                  }}
                  disabled={statusMoveTask.status === status}
                  className="w-full min-h-11 px-4 rounded-lg border border-mc-border bg-mc-bg text-left text-sm disabled:opacity-40 flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full ${config.color}`} />
                  {config.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSprintDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setShowSprintDropdown(false)} />
      )}
    </div>
  );
}

// Milestone Group Component for List View
interface MilestoneGroupProps {
  milestone: Milestone | null;
  coordinator: Agent | null;
  tasks: Task[];
  done: number;
  total: number;
  progress: number;
  isPortrait: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onTaskClick: (task: Task) => void;
  onMoveStatus: (task: Task) => void;
  onCreateTask: (milestoneId?: string) => void;
  mobileMode: boolean;
}

function MilestoneGroup({
  milestone,
  coordinator,
  tasks,
  done,
  total,
  progress,
  isPortrait,
  isExpanded,
  onToggle,
  onTaskClick,
  onMoveStatus,
  onCreateTask,
  mobileMode,
}: MilestoneGroupProps) {
  const sortedTasks = [...tasks].sort((a, b) => {
    const aDone = DONE_STATUSES.includes(a.status);
    const bDone = DONE_STATUSES.includes(b.status);
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;
    return 0;
  });

  const priorityColor = milestone?.priority ? PRIORITY_COLORS[milestone.priority] : null;
  const storyPoints = milestone?.story_points;
  const hasDependencies = milestone?.dependencies && milestone.dependencies.length > 0;

  return (
    <section className="bg-mc-bg-secondary border border-mc-border rounded-xl overflow-hidden shadow-[0_12px_30px_-28px_rgba(0,0,0,0.35)]">
      <button
        onClick={onToggle}
        aria-label={`Toggle ${milestone?.name || 'Ungrouped Tasks'} group`}
        className={`w-full px-4 py-3 border-b border-mc-border bg-mc-bg text-left ${isPortrait ? '' : 'px-3 py-2.5'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 flex-shrink-0 text-mc-text-secondary" />
            ) : (
              <ChevronRight className="w-4 h-4 flex-shrink-0 text-mc-text-secondary" />
            )}
            <Target className={`w-4 h-4 flex-shrink-0 ${milestone ? 'text-mc-accent' : 'text-mc-text-secondary'}`} />
            <h3 className="font-mono font-medium truncate">{milestone?.name || 'Ungrouped Tasks'}</h3>
            {priorityColor && (
              <span className={`text-white text-xs px-1.5 py-0.5 rounded ${priorityColor}`}>
                {milestone?.priority}
              </span>
            )}
            {storyPoints !== undefined && storyPoints > 0 && (
              <span className="text-xs text-mc-text-secondary">
                {storyPoints} pts
              </span>
            )}
            {coordinator && (
              <div className="flex items-center gap-1.5 text-mc-text-secondary">
                <Crown className="w-3.5 h-3.5" />
                <AgentInitials name={coordinator.name} size="xs" />
              </div>
            )}
            {hasDependencies && (
              <div className="flex items-center gap-1 text-mc-text-secondary">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="text-xs">Depends on: {milestone?.dependencies?.length} milestone(s)</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateTask(milestone?.id);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-mc-border rounded text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Task</span>
            </button>
            <span className={`text-sm font-medium ${done === total && total > 0 ? 'text-mc-accent-green' : 'text-mc-text-secondary'}`}>
              {done}/{total}
            </span>
            <div className="w-24 h-2 bg-mc-bg-tertiary rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${done === total && total > 0 ? 'bg-mc-accent-green' : 'bg-mc-accent'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="divide-y divide-mc-border">
          {sortedTasks.length === 0 ? (
            <div className="px-4 py-4 text-sm text-mc-text-secondary flex items-center justify-between gap-3 flex-wrap">
              <span>No tasks yet in this milestone.</span>
              <button
                type="button"
                onClick={() => onCreateTask(milestone?.id)}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs border border-mc-border rounded text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Task
              </button>
            </div>
          ) : (
            sortedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isPortrait={isPortrait}
                onClick={() => onTaskClick(task)}
                onMoveStatus={() => onMoveStatus(task)}
                mobileMode={mobileMode}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

// Milestone Board Component with Swimlanes
interface MilestoneBoardProps {
  milestoneOrder: string[];
  milestones: Milestone[];
  tasksByMilestone: Record<string, Task[]>;
  hasUngrouped: boolean;
  agents: Agent[];
  onTaskClick: (task: Task) => void;
  draggedTask: Task | null;
  setDraggedTask: (task: Task | null) => void;
  updateTaskStatusWithPersist: (task: Task, status: TaskStatus) => Promise<void>;
}

function MilestoneBoard({
  milestoneOrder,
  milestones,
  tasksByMilestone,
  hasUngrouped,
  agents,
  onTaskClick,
  draggedTask,
  setDraggedTask,
  updateTaskStatusWithPersist,
}: MilestoneBoardProps) {
  // Build swimlane data: milestones + ungrouped
  const swimlanes: { id: string; milestone: Milestone | null; tasks: Task[] }[] = useMemo(() => {
    const lanes = milestoneOrder.map((milestoneId) => ({
      id: milestoneId,
      milestone: milestones.find((m) => m.id === milestoneId) || null,
      tasks: tasksByMilestone[milestoneId] || [],
    }));

    if (hasUngrouped) {
      lanes.push({
        id: 'ungrouped',
        milestone: null,
        tasks: tasksByMilestone['ungrouped'],
      });
    }

    return lanes;
  }, [milestoneOrder, milestones, tasksByMilestone, hasUngrouped]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-max">
        {/* Header row with column names */}
        <div className="flex border-b border-mc-border bg-mc-bg-secondary sticky top-0 z-10">
          <div className="w-48 flex-shrink-0 px-3 py-2 border-r border-mc-border">
            <span className="text-xs font-medium uppercase text-mc-text-secondary tracking-wide">Milestone</span>
          </div>
          {BOARD_COLUMN_CONFIG.map(({ status, borderColor }) => {
            const config = STATUS_CONFIG[status];
            const count = swimlanes.reduce((sum, lane) => sum + lane.tasks.filter((t) => t.status === status).length, 0);
            return (
              <div
                key={status}
                className={`w-48 flex-shrink-0 px-3 py-2 border-r border-mc-border border-t-2 ${borderColor}`}
              >
                <span className="text-xs font-medium uppercase text-mc-text-secondary tracking-wide">{config.label}</span>
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-mc-text-secondary font-medium">{count}</span>
              </div>
            );
          })}
        </div>

        {/* Swimlane rows */}
        {swimlanes.map((lane) => {
          const priorityColor = lane.milestone?.priority ? PRIORITY_COLORS[lane.milestone.priority] : null;
          const storyPoints = lane.milestone?.story_points;
          const coordinator = lane.milestone?.coordinator_agent_id
            ? agents.find((a) => a.id === lane.milestone?.coordinator_agent_id)
            : null;
          const hasDependencies = lane.milestone?.dependencies && lane.milestone.dependencies.length > 0;

          return (
            <div key={lane.id} className="flex border-b border-mc-border">
              {/* Swimlane header */}
              <div className="w-48 flex-shrink-0 px-3 py-2 border-r border-mc-border bg-mc-bg-secondary">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Target className={`w-3.5 h-3.5 flex-shrink-0 ${lane.milestone ? 'text-mc-accent' : 'text-mc-text-secondary'}`} />
                  <span className="font-mono text-sm font-medium truncate">{lane.milestone?.name || 'Ungrouped'}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {priorityColor && (
                    <span className={`text-white text-xs px-1.5 py-0.5 rounded ${priorityColor}`}>
                      {lane.milestone?.priority}
                    </span>
                  )}
                  {storyPoints !== undefined && storyPoints > 0 && (
                    <span className="text-xs text-mc-text-secondary">{storyPoints} pts</span>
                  )}
                  {coordinator && (
                    <div className="flex items-center gap-1">
                      <Crown className="w-3 h-3 text-mc-text-secondary" />
                      <AgentInitials name={coordinator.name} size="xs" />
                    </div>
                  )}
                  {hasDependencies && (
                    <div className="flex items-center gap-1 text-mc-text-secondary">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">{lane.milestone?.dependencies?.length}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status columns within swimlane */}
              {BOARD_COLUMN_CONFIG.map(({ status }) => {
                const columnTasks = lane.tasks.filter((t) => t.status === status);
                return (
                  <div
                    key={status}
                    className={`w-48 flex-shrink-0 p-1.5 min-h-[80px] bg-mc-bg border-r border-mc-border ${
                      draggedTask ? '' : ''
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('bg-mc-bg-tertiary/30');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('bg-mc-bg-tertiary/30');
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('bg-mc-bg-tertiary/30');
                      if (draggedTask && draggedTask.status !== status) {
                        await updateTaskStatusWithPersist(draggedTask, status);
                      }
                      setDraggedTask(null);
                    }}
                  >
                    <div className="space-y-1.5">
                      {columnTasks.map((task) => (
                        (() => {
                          const assignee = getTaskAssigneePresentation(task);
                          return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggedTask(task);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => onTaskClick(task)}
                          className="group bg-mc-bg-secondary border border-mc-border/50 rounded p-2 cursor-pointer hover:border-mc-accent/40 hover:shadow transition-all relative"
                        >
                          <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                            <GripVertical className="w-3 h-3 text-mc-text-secondary" />
                          </div>
                          <div className="flex items-center gap-1.5 mb-1 pl-3">
                            {(() => { const TI = TASK_TYPE_CONFIG[task.task_type]; return TI ? <TI.icon className={`w-3.5 h-3.5 flex-shrink-0 ${TI.color}`} /> : null; })()}
                            <h4 className="font-medium text-xs line-clamp-2">{task.title}</h4>
                          </div>
                          <div className="flex items-center gap-1.5 pl-3">
                            <span className={`w-1.5 h-1.5 rounded-full ${task.priority === 'urgent' ? 'bg-red-500' : task.priority === 'high' ? 'bg-orange-500' : task.priority === 'normal' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                            {assignee && (
                              <AgentInitials name={assignee.badge} size="xs" />
                            )}
                          </div>
                        </div>
                          );
                        })()
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Task Row Component
interface TaskRowProps {
  task: Task;
  isPortrait: boolean;
  onClick: () => void;
  onMoveStatus: () => void;
  mobileMode: boolean;
}

function TaskRow({ task, isPortrait, onClick, onMoveStatus, mobileMode }: TaskRowProps) {
  const statusConfig = STATUS_CONFIG[task.status];
  const isDone = DONE_STATUSES.includes(task.status);
  const isPlanning = task.status === 'planning';
  const dispatchError = task.planning_dispatch_error;
  const TypeIcon = TASK_TYPE_CONFIG[task.task_type]?.icon;
  const typeColor = TASK_TYPE_CONFIG[task.task_type]?.color;
  const assignee = getTaskAssigneePresentation(task);

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-mc-bg-tertiary/30 ${isPortrait ? 'px-4 py-3' : 'px-3 py-2.5'}`}
    >
      <div className="flex items-start gap-3">
        {TypeIcon ? (
          <TypeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${typeColor}`} />
        ) : (
          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isDone ? 'bg-mc-accent-green' : statusConfig.color}`} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`flex-1 min-w-0 font-medium leading-snug truncate ${isDone ? 'text-mc-text-secondary line-through' : ''} text-sm`}>
              {task.title}
            </h4>
            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusConfig.color} text-white`}>
              {statusConfig.label}
            </span>
          </div>

          {isPlanning && (
            <div className={`flex items-center gap-2 mb-2 py-1.5 px-2.5 bg-amber-50 rounded border border-amber-200 ${isPortrait ? 'text-xs' : 'text-xs'}`}>
              <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-amber-700 font-medium">Planning still in progress</span>
            </div>
          )}

          {task.status === 'assigned' && dispatchError && (
            <div className={`flex items-start gap-2 mb-2 py-1.5 px-2.5 bg-red-600/12 rounded border border-red-600/25 ${isPortrait ? 'text-xs' : 'text-xs'}`}>
              <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5 flex-shrink-0" />
              <span className="text-red-700">Assigned, but blocked: {dispatchError}</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-mc-text-secondary">
            {assignee && (
              <div className="flex items-center gap-1.5">
                <AgentInitials name={assignee.badge} size="xs" />
                <span className="font-medium">{assignee.badge}</span>
                {assignee.name ? <span className="truncate">{assignee.name}</span> : null}
              </div>
            )}
            <span className="capitalize">{task.priority}</span>
            <span>{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</span>
          </div>

          {mobileMode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveStatus();
              }}
              className={`w-full min-h-11 rounded-md border border-mc-border bg-mc-bg flex items-center justify-center gap-2 text-mc-text-secondary ${isPortrait ? 'mt-3 text-sm' : 'mt-2 text-xs'}`}
            >
              <ArrowRightLeft className="w-4 h-4" />
              Move Status
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
