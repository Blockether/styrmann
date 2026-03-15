'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Columns3,
  GripVertical,
  LayoutList,
  Loader2,
  Target,
  Bug,
  Lightbulb,
  Wrench,
  BookOpen,
  FlaskConical,
  Zap,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStyrmann } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import { useTaskDeepLink } from '@/hooks/useTaskDeepLink';
import { TaskModal } from './TaskModal';
import { AgentInitials } from './AgentInitials';
import type { Milestone, Task, TaskStatus, TaskType } from '@/lib/types';

interface WorkspaceTasksProps {
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

const TASK_TYPE_CONFIG: Record<TaskType, { icon: typeof Bug; color: string }> = {
  bug: { icon: Bug, color: 'text-red-500' },
  feature: { icon: Lightbulb, color: 'text-yellow-500' },
  chore: { icon: Wrench, color: 'text-blue-500' },
  documentation: { icon: BookOpen, color: 'text-green-500' },
  research: { icon: FlaskConical, color: 'text-purple-500' },
  spike: { icon: Zap, color: 'text-orange-500' },
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

export function WorkspaceTasks({ workspaceId, mobileMode = false, isPortrait = true }: WorkspaceTasksProps) {
  const { tasks: storeTasks, updateTaskStatus, addEvent } = useStyrmann();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const { linkedTask, initialTab, openTask, closeTask, updateTab } = useTaskDeepLink();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const activeEditingTask = editingTask || linkedTask;
  const [statusMoveTask, setStatusMoveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [selectedBoardStatus, setSelectedBoardStatus] = useState<TaskStatus>('planning');
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        setLoading(true);
        const milestonesRes = await fetch(`/api/milestones?workspace_id=${workspaceId}`);


        if (milestonesRes.ok) {
          setMilestones(await milestonesRes.json());
        }
      } catch (error) {
        console.error('Failed to load workspace resources:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [workspaceId]);

  const workspaceTasks = useMemo(() => {
    const filtered = storeTasks.filter((task) => task.workspace_id === workspaceId);
    return [...filtered].sort((a, b) => {
      const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [storeTasks, workspaceId]);

  const milestoneNameById = useMemo(() => {
    return new Map(milestones.map((milestone) => [milestone.id, milestone.name]));
  }, [milestones]);

  const totalTasks = workspaceTasks.length;
  const completedTasks = workspaceTasks.filter((task) => DONE_STATUSES.includes(task.status)).length;
  const inProgressTasks = workspaceTasks.filter((task) => ['assigned', 'in_progress', 'testing', 'review', 'verification'].includes(task.status)).length;
  const completionPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

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
          id: `${task.id}-${Date.now()}`,
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

  const handleTaskClick = (task: Task) => {
    setEditingTask(task);
    openTask(task);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-mc-text-secondary" />
      </div>
    );
  }

  return (
    <div data-component="src/components/WorkspaceTasks" className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-mc-border bg-mc-bg text-mc-text-secondary">
              Total: <span className="font-medium text-mc-text">{totalTasks}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-mc-border bg-mc-bg text-mc-text-secondary">
              In Progress: <span className="font-medium text-mc-text">{inProgressTasks}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-green-200 bg-green-50 text-green-700">
              Done: <span className="font-medium">{completedTasks} ({completionPercent}%)</span>
            </span>
          </div>
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
        </div>
        {milestones.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-mc-text-secondary">Milestones:</span>
            {milestones.map((milestone) => (
              <span key={milestone.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-mc-border bg-mc-bg">
                <Target className="w-3 h-3 text-mc-accent" />
                <span>{milestone.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto ${viewMode === 'board' ? 'overflow-hidden' : ''} ${isPortrait && viewMode === 'list' ? 'p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]' : viewMode === 'list' ? 'p-3' : ''}`}>
        {workspaceTasks.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
              <Target className="w-6 h-6 text-mc-text-secondary" />
            </div>
            <h3 className="text-base font-medium mb-1">No tasks yet</h3>
            <p className="text-sm text-mc-text-secondary">Tasks are created automatically when org tickets are delegated.</p>
          </div>
        ) : viewMode === 'list' ? (
          <div className={`space-y-2 ${isPortrait ? '' : 'space-y-1.5'}`}>
            {workspaceTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                milestoneName={task.milestone_id ? milestoneNameById.get(task.milestone_id) : undefined}
                isPortrait={isPortrait}
                onClick={() => handleTaskClick(task)}
                onMoveStatus={() => setStatusMoveTask(task)}
                mobileMode={mobileMode}
              />
            ))}
          </div>
        ) : mobileMode ? (
          <div className="flex flex-col h-full">
            <div className="flex gap-2 p-3 overflow-x-auto border-b border-mc-border flex-shrink-0">
              {BOARD_COLUMN_CONFIG.map(({ status }) => {
                const count = workspaceTasks.filter((task) => task.status === status).length;
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
              {workspaceTasks
                .filter((task) => task.status === selectedBoardStatus)
                .map((task) => {
                  const assignee = getTaskAssigneePresentation(task);
                  const TaskTypeIcon = TASK_TYPE_CONFIG[task.task_type]?.icon;
                  const taskTypeColor = TASK_TYPE_CONFIG[task.task_type]?.color;

                  return (
                    <div
                      key={task.id}
                      onClick={() => handleTaskClick(task)}
                      className="bg-mc-bg-secondary border border-mc-border/50 rounded-lg p-3 cursor-pointer hover:border-mc-accent/40 transition-colors"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        {TaskTypeIcon ? (
                          <TaskTypeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${taskTypeColor}`} />
                        ) : (
                          <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${STATUS_CONFIG[task.status].color}`} />
                        )}
                        <h4 className="font-medium text-sm line-clamp-2 flex-1">{task.title}</h4>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-mc-text-secondary mb-2">
                        {assignee && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <AgentInitials name={assignee.badge} size="xs" />
                            <span className="font-medium">{assignee.badge}</span>
                            {assignee.name ? <span className="truncate">{assignee.name}</span> : null}
                          </div>
                        )}
                        <span className="capitalize">{task.priority}</span>
                      </div>
                      {task.milestone_id && milestoneNameById.get(task.milestone_id) && (
                        <div className="mb-3 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-mc-border bg-mc-bg">
                          <Target className="w-3 h-3 text-mc-accent" />
                          <span className="truncate max-w-[180px]">{milestoneNameById.get(task.milestone_id)}</span>
                        </div>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setStatusMoveTask(task);
                        }}
                        className="w-full min-h-11 rounded-md border border-mc-border bg-mc-bg flex items-center justify-center gap-2 text-mc-text-secondary text-sm hover:bg-mc-bg-tertiary transition-colors"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                        Move Status
                      </button>
                    </div>
                  );
                })}
              {workspaceTasks.filter((task) => task.status === selectedBoardStatus).length === 0 && (
                <div className="text-center py-8 text-mc-text-secondary text-sm">
                  No tasks in {STATUS_CONFIG[selectedBoardStatus].label}
                </div>
              )}
            </div>
          </div>
        ) : (
          <BoardView
            tasks={workspaceTasks}
            milestoneNameById={milestoneNameById}
            onTaskClick={handleTaskClick}
            draggedTask={draggedTask}
            setDraggedTask={setDraggedTask}
            updateTaskStatusWithPersist={updateTaskStatusWithPersist}
          />
        )}
      </div>

      {activeEditingTask && (
        <TaskModal
          task={activeEditingTask}
          onClose={() => {
            setEditingTask(null);
            closeTask();
          }}
          workspaceId={workspaceId}
          defaultTab={linkedTask ? initialTab : undefined}
          onTabChange={updateTab}
          onNavigateToTask={(task) => {
            setEditingTask(null);
            closeTask();
            openTask(task);
            setEditingTask(task);
          }}
        />
      )}

      {mobileMode && statusMoveTask && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-end sm:items-center sm:justify-center" onClick={() => setStatusMoveTask(null)}>
          <div
            className="w-full sm:max-w-md bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl p-4"
            onClick={(event) => event.stopPropagation()}
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
    </div>
  );
}

interface BoardViewProps {
  tasks: Task[];
  milestoneNameById: Map<string, string>;
  onTaskClick: (task: Task) => void;
  draggedTask: Task | null;
  setDraggedTask: (task: Task | null) => void;
  updateTaskStatusWithPersist: (task: Task, status: TaskStatus) => Promise<void>;
}

function BoardView({
  tasks,
  milestoneNameById,
  onTaskClick,
  draggedTask,
  setDraggedTask,
  updateTaskStatusWithPersist,
}: BoardViewProps) {
  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3 min-w-0">
        {BOARD_COLUMN_CONFIG.map(({ status, borderColor }) => {
          const config = STATUS_CONFIG[status];
          const columnTasks = tasks.filter((task) => task.status === status);

          return (
            <div
              key={status}
              className={`min-w-0 rounded-lg border border-mc-border bg-mc-bg-secondary border-t-2 ${borderColor} flex flex-col max-h-[calc(100vh-18rem)]`}
              onDragOver={(event) => {
                event.preventDefault();
                event.currentTarget.classList.add('bg-mc-bg-tertiary/30');
              }}
              onDragLeave={(event) => {
                event.currentTarget.classList.remove('bg-mc-bg-tertiary/30');
              }}
              onDrop={async (event) => {
                event.preventDefault();
                event.currentTarget.classList.remove('bg-mc-bg-tertiary/30');
                if (draggedTask && draggedTask.status !== status) {
                  await updateTaskStatusWithPersist(draggedTask, status);
                }
                setDraggedTask(null);
              }}
            >
              <div className="px-3 py-2 border-b border-mc-border flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase text-mc-text-secondary tracking-wide">{config.label}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-mc-bg-tertiary text-mc-text-secondary font-medium">{columnTasks.length}</span>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto">
                {columnTasks.map((task) => {
                  const assignee = getTaskAssigneePresentation(task);
                  const TaskTypeIcon = TASK_TYPE_CONFIG[task.task_type]?.icon;
                  const taskTypeColor = TASK_TYPE_CONFIG[task.task_type]?.color;

                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(event) => {
                        setDraggedTask(task);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => onTaskClick(task)}
                      className="group bg-mc-bg border border-mc-border rounded p-2 cursor-pointer hover:border-mc-accent/40 hover:shadow transition-all relative"
                    >
                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                        <GripVertical className="w-3 h-3 text-mc-text-secondary" />
                      </div>
                      <div className="flex items-center gap-1.5 mb-1 pl-3">
                        {TaskTypeIcon ? <TaskTypeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${taskTypeColor}`} /> : null}
                        <h4 className="font-medium text-xs line-clamp-2">{task.title}</h4>
                      </div>
                      <div className="pl-3 text-[11px] text-mc-text-secondary space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${task.priority === 'urgent' ? 'bg-red-500' : task.priority === 'high' ? 'bg-orange-500' : task.priority === 'normal' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                          <span className="capitalize">{task.priority}</span>
                          {assignee && <AgentInitials name={assignee.badge} size="xs" />}
                        </div>
                        {task.milestone_id && milestoneNameById.get(task.milestone_id) && (
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-mc-border bg-mc-bg-secondary">
                            <Target className="w-3 h-3 text-mc-accent" />
                            <span className="truncate max-w-[120px]">{milestoneNameById.get(task.milestone_id)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {columnTasks.length === 0 && (
                  <div className="text-center py-6 text-mc-text-secondary text-xs">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  milestoneName?: string;
  isPortrait: boolean;
  onClick: () => void;
  onMoveStatus: () => void;
  mobileMode: boolean;
}

function TaskRow({ task, milestoneName, isPortrait, onClick, onMoveStatus, mobileMode }: TaskRowProps) {
  const statusConfig = STATUS_CONFIG[task.status];
  const isDone = DONE_STATUSES.includes(task.status);
  const isPlanning = task.status === 'planning';
  const TypeIcon = TASK_TYPE_CONFIG[task.task_type]?.icon;
  const typeColor = TASK_TYPE_CONFIG[task.task_type]?.color;
  const assignee = getTaskAssigneePresentation(task);

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-mc-bg-tertiary/30 rounded-lg border border-mc-border bg-mc-bg-secondary ${isPortrait ? 'px-4 py-3' : 'px-3 py-2.5'}`}
    >
      <div className="flex items-start gap-3">
        {TypeIcon ? (
          <TypeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${typeColor}`} />
        ) : (
          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isDone ? 'bg-mc-accent-green' : statusConfig.color}`} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className={`flex-1 min-w-0 font-medium leading-snug truncate ${isDone ? 'text-mc-text-secondary line-through' : ''} text-sm`}>
              {task.title}
            </h4>
            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusConfig.color} text-white`}>
              {statusConfig.label}
            </span>
          </div>

          {isPlanning && (
            <div className="flex items-center gap-2 mb-2 py-1.5 px-2.5 bg-amber-50 rounded border border-amber-200 text-xs">
              <div className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-amber-700 font-medium">Planning still in progress</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-mc-text-secondary flex-wrap">
            {assignee && (
              <div className="flex items-center gap-1.5 min-w-0">
                <AgentInitials name={assignee.badge} size="xs" />
                <span className="font-medium">{assignee.badge}</span>
                {assignee.name ? <span className="truncate">{assignee.name}</span> : null}
              </div>
            )}
            <span className="capitalize">{task.priority}</span>
            {milestoneName && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-mc-border bg-mc-bg">
                <Target className="w-3 h-3 text-mc-accent" />
                <span className="truncate max-w-[180px]">{milestoneName}</span>
              </span>
            )}
            <span>{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</span>
          </div>

          {mobileMode && (
            <button
              onClick={(event) => {
                event.stopPropagation();
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
