'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronDown, CheckCircle2, Loader2, Flag, Users, Calendar, ChevronRight, ArrowRightLeft, LayoutList, Columns3, GripVertical } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskStatus, Sprint, Milestone, Agent } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { AgentInitials } from './AgentInitials';
import { formatDistanceToNow } from 'date-fns';

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

export function ActiveSprint({ workspaceId, mobileMode = false, isPortrait = true }: ActiveSprintProps) {
  const { tasks: storeTasks, updateTaskStatus, addEvent } = useMissionControl();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSprintDropdown, setShowSprintDropdown] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [endingSprint, setEndingSprint] = useState(false);
    const [creatingSprint, setCreatingSprint] = useState(false);
    const [statusMoveTask, setStatusMoveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [selectedBoardStatus, setSelectedBoardStatus] = useState<TaskStatus>('planning');
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    async function loadData() {
      try {
        setLoading(true);
        const [sprintsRes, milestonesRes, agentsRes] = await Promise.all([
          fetch(`/api/sprints?workspace_id=${workspaceId}`),
          fetch(`/api/milestones?workspace_id=${workspaceId}`),
          fetch(`/api/agents?workspace_id=${workspaceId}`),
        ]);

        if (sprintsRes.ok) {
          const sprintsData: Sprint[] = await sprintsRes.json();
          setSprints(sprintsData);

          const activeSprint = sprintsData.find((s) => s.status === 'active');
          const planningSprint = sprintsData.find((s) => s.status === 'planning');
          setSelectedSprintId(activeSprint?.id || planningSprint?.id || null);
        }

        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
      } catch (error) {
        console.error('Failed to load sprint data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [workspaceId]);

    const sprintTasks = useMemo(() => {
      if (!selectedSprintId) return [];
      return storeTasks.filter((t) => t.sprint_id === selectedSprintId);
    }, [storeTasks, selectedSprintId]);

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

    const selectedSprint = sprints.find((s) => s.id === selectedSprintId);
    const activeSprint = sprints.find((s) => s.status === 'active');

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

    const milestoneOrder = milestones
      .filter((m) => tasksByMilestone[m.id]?.length > 0)
      .map((m) => m.id);
    const hasUngrouped = tasksByMilestone['ungrouped'].length > 0;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 ${mobileMode && isPortrait ? 'flex-wrap' : ''}`}>
          <div className="flex items-center gap-2">
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
            
            <div className="relative">
              <button
                onClick={() => setShowSprintDropdown(!showSprintDropdown)}
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
            <div className="flex items-center bg-mc-bg-tertiary rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors min-h-9 ${
                  viewMode === 'list' ? 'bg-mc-accent text-white' : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                <LayoutList className="w-4 h-4" />
                <span className="hidden sm:inline">List</span>
              </button>
              <button
                onClick={() => setViewMode('board')}
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
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 min-h-11 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </div>

        <div className={`flex-1 overflow-y-auto ${viewMode === 'board' ? 'overflow-hidden' : ''} ${isPortrait && viewMode === 'list' ? 'p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]' : viewMode === 'list' ? 'p-3' : ''}`}>
          {sprintTasks.length === 0 ? (
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
                    onTaskClick={setEditingTask}
                    onMoveStatus={setStatusMoveTask}
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
                  onTaskClick={setEditingTask}
                  onMoveStatus={setStatusMoveTask}
                  mobileMode={mobileMode}
                />
              )}
            </div>
          ) : mobileMode ? (
            <div className="flex flex-col h-full">
              <div className="flex gap-2 p-3 overflow-x-auto border-b border-mc-border flex-shrink-0">
                {BOARD_COLUMN_CONFIG.map(({ status, borderColor }) => {
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
                    <div
                      key={task.id}
                      onClick={() => setEditingTask(task)}
                      className="bg-mc-bg-secondary border border-mc-border/50 rounded-lg p-3 cursor-pointer hover:border-mc-accent/40 transition-colors"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STATUS_CONFIG[task.status].color}`} />
                        <h4 className="font-medium text-sm line-clamp-2 flex-1">{task.title}</h4>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-mc-text-secondary mb-3">
                        {task.assigned_agent && (
                          <div className="flex items-center gap-1.5">
                            <AgentInitials name={(task.assigned_agent as unknown as { name: string }).name} size="xs" />
                            <span className="truncate">{(task.assigned_agent as unknown as { name: string }).name}</span>
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
                  ))}
                {sprintTasks.filter((t) => t.status === selectedBoardStatus).length === 0 && (
                  <div className="text-center py-8 text-mc-text-secondary text-sm">
                    No tasks in {STATUS_CONFIG[selectedBoardStatus].label}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
              {BOARD_COLUMN_CONFIG.map(({ status, borderColor }) => {
                const columnTasks = sprintTasks.filter((t) => t.status === status);
                const config = STATUS_CONFIG[status];
                return (
                  <div
                    key={status}
                    className={`min-w-[200px] flex-1 max-w-[280px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 ${borderColor}`}
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
                    <div className="px-3 py-2 border-b border-mc-border/50 flex items-center justify-between flex-shrink-0">
                      <span className="text-xs font-medium uppercase text-mc-text-secondary tracking-wide">{config.label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-mc-text-secondary font-medium">{columnTasks.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {columnTasks.map((task) => (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggedTask(task);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onClick={() => setEditingTask(task)}
                          className="group bg-mc-bg-secondary border border-mc-border/50 rounded-lg p-3 cursor-pointer hover:border-mc-accent/40 hover:shadow-lg transition-all relative"
                        >
                          <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                            <GripVertical className="w-4 h-4 text-mc-text-secondary" />
                          </div>
                          <h4 className="font-medium text-sm line-clamp-2 mb-2 pl-4">{task.title}</h4>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`w-2 h-2 rounded-full ${task.priority === 'urgent' ? 'bg-red-500' : task.priority === 'high' ? 'bg-orange-500' : task.priority === 'normal' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                            <span className="text-xs text-mc-text-secondary capitalize">{task.priority}</span>
                          </div>
                          {task.assigned_agent && (
                            <div className="flex items-center gap-1.5 mb-2">
                              <AgentInitials name={(task.assigned_agent as unknown as { name: string }).name} size="xs" />
                              <span className="text-xs text-mc-text-secondary truncate">{(task.assigned_agent as unknown as { name: string }).name}</span>
                            </div>
                          )}
                          <div className="text-xs text-mc-text-secondary">
                            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showCreateModal && (
          <TaskModal
            onClose={() => setShowCreateModal(false)}
            workspaceId={workspaceId}
            defaultSprintId={selectedSprintId || undefined}
          />
        )}
        {editingTask && (
          <TaskModal
            task={editingTask}
            onClose={() => setEditingTask(null)}
            workspaceId={workspaceId}
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

interface MilestoneGroupProps {
  milestone: Milestone | null;
  coordinator: Agent | null;
  tasks: Task[];
  done: number;
  total: number;
  progress: number;
  isPortrait: boolean;
  onTaskClick: (task: Task) => void;
  onMoveStatus: (task: Task) => void;
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
  onTaskClick,
  onMoveStatus,
  mobileMode,
}: MilestoneGroupProps) {
  const sortedTasks = [...tasks].sort((a, b) => {
    const aDone = DONE_STATUSES.includes(a.status);
    const bDone = DONE_STATUSES.includes(b.status);
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;
    return 0;
  });

  return (
    <section className="bg-mc-bg-secondary border border-mc-border rounded-xl overflow-hidden">
      <div className={`px-4 py-3 border-b border-mc-border bg-mc-bg-tertiary/50 ${isPortrait ? '' : 'px-3 py-2.5'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Flag className={`w-4 h-4 flex-shrink-0 ${milestone ? 'text-mc-accent' : 'text-mc-text-secondary'}`} />
            <h3 className="font-medium truncate">{milestone?.name || 'Ungrouped'}</h3>
            {coordinator && (
              <div className="flex items-center gap-1.5 text-mc-text-secondary">
                <Users className="w-3.5 h-3.5" />
                <AgentInitials name={coordinator.name} size="xs" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`text-sm font-medium ${done === total && total > 0 ? 'text-mc-accent-green' : 'text-mc-text-secondary'}`}>
              {done}/{total}
            </span>
            <div className="w-24 h-2 bg-mc-border rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${done === total && total > 0 ? 'bg-mc-accent-green' : 'bg-mc-accent'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-mc-border">
        {sortedTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            isPortrait={isPortrait}
            onClick={() => onTaskClick(task)}
            onMoveStatus={() => onMoveStatus(task)}
            mobileMode={mobileMode}
          />
        ))}
      </div>
    </section>
  );
}

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

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-mc-bg-tertiary/30 ${isPortrait ? 'px-4 py-3' : 'px-3 py-2.5'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isDone ? 'bg-mc-accent-green' : statusConfig.color}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`font-medium leading-snug truncate ${isDone ? 'text-mc-text-secondary line-through' : ''} ${isPortrait ? 'text-sm' : 'text-sm'}`}>
              {task.title}
            </h4>
            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusConfig.color} text-white`}>
              {statusConfig.label}
            </span>
          </div>

          {isPlanning && (
            <div className={`flex items-center gap-2 mb-2 py-1.5 px-2.5 bg-purple-600/15 rounded border border-purple-600/25 ${isPortrait ? 'text-xs' : 'text-xs'}`}>
              <div className="w-1.5 h-1.5 bg-purple-600 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-purple-700 font-medium">Continue planning</span>
            </div>
          )}

          {task.status === 'assigned' && dispatchError && (
            <div className={`flex items-start gap-2 mb-2 py-1.5 px-2.5 bg-red-600/12 rounded border border-red-600/25 ${isPortrait ? 'text-xs' : 'text-xs'}`}>
              <div className="w-1.5 h-1.5 bg-red-600 rounded-full mt-0.5 flex-shrink-0" />
              <span className="text-red-700">Assigned, but blocked: {dispatchError}</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-mc-text-secondary">
            {task.assigned_agent && (
              <div className="flex items-center gap-1.5">
                <AgentInitials name={(task.assigned_agent as unknown as { name: string }).name} size="xs" />
                <span className="truncate">{(task.assigned_agent as unknown as { name: string }).name}</span>
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
