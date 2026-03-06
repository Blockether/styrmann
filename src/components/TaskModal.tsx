'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Save, Trash2, Activity, Package, Bot, ClipboardList, Plus, Users } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import { ActivityLog } from './ActivityLog';
import { DeliverablesList } from './DeliverablesList';
import { SessionsList } from './SessionsList';
import { PlanningTab } from './PlanningTab';
import { TeamTab } from './TeamTab';
import { AgentModal } from './AgentModal';
import type { Task, TaskPriority, TaskStatus, TaskType, GitHubIssue } from '@/lib/types';

type TabType = 'overview' | 'planning' | 'team' | 'activity' | 'deliverables' | 'sessions';

interface TaskModalProps {
  task?: Task;
  onClose: () => void;
  workspaceId?: string;
  defaultSprintId?: string;
  githubIssue?: GitHubIssue;
}

export function TaskModal({ task, onClose, workspaceId, defaultSprintId, githubIssue }: TaskModalProps) {
  const { agents, addTask, updateTask, addEvent } = useMissionControl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [usePlanningMode, setUsePlanningMode] = useState(false);
  // Auto-switch to planning tab if task is in planning status
  const [activeTab, setActiveTab] = useState<TabType>(task?.status === 'planning' ? 'planning' : 'overview');

  // Stable callback for when spec is locked - use window.location.reload() to refresh data
  const handleSpecLocked = useCallback(() => {
    window.location.reload();
  }, []);

  const [form, setForm] = useState({
    title: githubIssue?.title || task?.title || '',
    description: githubIssue?.body || task?.description || '',
    priority: task?.priority || 'normal' as TaskPriority,
    status: task?.status || 'inbox' as TaskStatus,
    assigned_agent_id: task?.assigned_agent_id || '',
    task_type: task?.task_type || 'feature' as TaskType,
    effort: task?.effort || null as number | null,
    impact: task?.impact || null as number | null,
    milestone_id: task?.milestone_id || '',
    github_issue_id: githubIssue?.id || task?.github_issue_id || null as string | null,
  });

  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([]);
  const [newCriteriaInput, setNewCriteriaInput] = useState('');
  const [milestones, setMilestones] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const wsId = workspaceId || task?.workspace_id || 'default';
    fetch(`/api/milestones?workspace_id=${wsId}`)
      .then(res => res.json())
      .then(data => setMilestones(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [workspaceId, task?.workspace_id]);

  const resolveStatus = (): TaskStatus => {
    // Planning mode overrides everything
    if (!task && usePlanningMode) return 'planning';
    // Auto-determine based on agent assignment
    const hasAgent = !!form.assigned_agent_id;
    if (!task) {
      // New task: agent → assigned, no agent → inbox
      return hasAgent ? 'assigned' : 'inbox';
    }
    // Existing task: if in inbox and agent just assigned, promote to assigned
    if (task.status === 'inbox' && hasAgent) return 'assigned';
    return form.status;
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent, keepOpen = false) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSaveError(null);

    try {
      const url = task ? `/api/tasks/${task.id}` : '/api/tasks';
      const method = task ? 'PATCH' : 'POST';
      const resolvedStatus = resolveStatus();

      const payload: Record<string, unknown> = {
        ...form,
        status: resolvedStatus,
        assigned_agent_id: form.assigned_agent_id || null,
        milestone_id: form.milestone_id || null,
        workspace_id: workspaceId || task?.workspace_id || 'default',
      };


      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSaveError(errData.error || `Save failed (${res.status})`);
        return;
      }

      const savedTask = await res.json();

      if (task) {
        // Editing existing task
        updateTask(savedTask);

        // Note: dispatch for existing tasks is handled server-side by the PATCH route.
        // Only trigger client-side dispatch for drag-to-in_progress (legacy flow).
        if (shouldTriggerAutoDispatch(task.status, savedTask.status, savedTask.assigned_agent_id)) {
          triggerAutoDispatch({
            taskId: savedTask.id,
            taskTitle: savedTask.title,
            agentId: savedTask.assigned_agent_id,
            agentName: savedTask.assigned_agent?.name || 'Unknown Agent',
            workspaceId: savedTask.workspace_id
          }).catch((err) => console.error('Auto-dispatch failed:', err));
        }

        onClose();
        return;
      }

      // Creating new task
      addTask(savedTask);
      addEvent({
        id: savedTask.id + '-created',
        type: 'task_created',
        task_id: savedTask.id,
        message: `New task: ${savedTask.title}`,
        created_at: new Date().toISOString(),
      });

      if (acceptanceCriteria.length > 0) {
        await Promise.all(
          acceptanceCriteria.map((description, index) =>
            fetch(`/api/tasks/${savedTask.id}/acceptance-criteria`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ description, sort_order: index }),
            }).catch((err) => console.error('Failed to create acceptance criteria:', err))
          )
        );
      }

      if (usePlanningMode) {
        // Start planning session (fire-and-forget), then close modal.
        // User reopens the task from the board to see the planning tab.
        fetch(`/api/tasks/${savedTask.id}/planning`, { method: 'POST' })
          .catch((error) => console.error('Failed to start planning:', error));
        onClose();
        return;
      }

      // Auto-dispatch if agent assigned (fire-and-forget)
      if (savedTask.assigned_agent_id && savedTask.status === 'assigned') {
        triggerAutoDispatch({
          taskId: savedTask.id,
          taskTitle: savedTask.title,
          agentId: savedTask.assigned_agent_id,
          agentName: savedTask.assigned_agent?.name || 'Unknown Agent',
          workspaceId: savedTask.workspace_id
        }).catch((err) => console.error('Auto-dispatch failed:', err));
      }

      if (keepOpen) {
        setForm({
          title: '',
          description: '',
          priority: 'normal' as TaskPriority,
          status: 'inbox' as TaskStatus,
          assigned_agent_id: '',
          task_type: 'feature' as TaskType,
          effort: null,
          impact: null,
          milestone_id: '',
          github_issue_id: null,
        });
        setUsePlanningMode(false);
        setAcceptanceCriteria([]);
        setNewCriteriaInput('');
      } else {
        onClose();
      }
    } catch (error) {
      console.error('Failed to save task:', error);
      setSaveError(error instanceof Error ? error.message : 'Network error — please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !confirm(`Delete "${task.title}"?`)) return;

    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        useMissionControl.setState((state) => ({
          tasks: state.tasks.filter((t) => t.id !== task.id),
        }));
        onClose();
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: null },
    { id: 'planning' as TabType, label: 'Planning', icon: <ClipboardList className="w-4 h-4" /> },
    { id: 'team' as TabType, label: 'Team', icon: <Users className="w-4 h-4" /> },
    { id: 'activity' as TabType, label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'deliverables' as TabType, label: 'Deliverables', icon: <Package className="w-4 h-4" /> },
    { id: 'sessions' as TabType, label: 'Sessions', icon: <Bot className="w-4 h-4" /> },
  ];

  return (
    <div data-component="src/components/TaskModal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-none md:rounded-lg w-full md:w-4/5 xl:w-3/5 h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">
            {task ? task.title : 'Create New Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs - only show for existing tasks */}
        {task && (
          <div className="flex border-b border-mc-border flex-shrink-0 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 min-h-11 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-mc-accent border-b-2 border-mc-accent'
                    : 'text-mc-text-secondary hover:text-mc-text'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              placeholder="What needs to be done?"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
              placeholder="Add details..."
            />
          </div>

          {/* Acceptance Criteria - only for new tasks */}
          {!task && (
            <div>
              <label className="block text-sm font-medium mb-1">Acceptance Criteria</label>
              {acceptanceCriteria.length > 0 && (
                <div className="space-y-2 mb-2">
                  {acceptanceCriteria.map((criteria, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 bg-mc-bg rounded border border-mc-border"
                    >
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-mc-bg-tertiary border border-mc-border" />
                      <span className="text-sm flex-1">{criteria}</span>
                      <button
                        type="button"
                        onClick={() => setAcceptanceCriteria(prev => prev.filter((_, i) => i !== index))}
                        className="p-1 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary hover:text-mc-accent-red"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCriteriaInput}
                  onChange={(e) => setNewCriteriaInput(e.target.value)}
                  placeholder="Add acceptance criteria..."
                  className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCriteriaInput.trim()) {
                      e.preventDefault();
                      setAcceptanceCriteria(prev => [...prev, newCriteriaInput.trim()]);
                      setNewCriteriaInput('');
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newCriteriaInput.trim()) {
                      setAcceptanceCriteria(prev => [...prev, newCriteriaInput.trim()]);
                      setNewCriteriaInput('');
                    }
                  }}
                  disabled={!newCriteriaInput.trim()}
                  className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Planning Mode Toggle - only for new tasks */}
          {!task && (
            <div className="p-3 bg-mc-bg rounded-lg border border-mc-border">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usePlanningMode}
                  onChange={(e) => setUsePlanningMode(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-mc-border"
                />
                <div>
                  <span className="font-medium text-sm flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-mc-accent" />
                    Enable Planning Mode
                  </span>
                  <p className="text-xs text-mc-text-secondary mt-1">
                    Best for complex projects that need detailed requirements. 
                    You&apos;ll answer a few questions to define scope, goals, and constraints 
                    before work begins. Skip this for quick, straightforward tasks.
                  </p>
                </div>
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Task Type</label>
              <select
                value={form.task_type}
                onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
                <option value="chore">Chore</option>
                <option value="documentation">Documentation</option>
                <option value="research">Research</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Effort</label>
              <select
                value={form.effort ?? ''}
                onChange={(e) => setForm({ ...form, effort: e.target.value ? Number(e.target.value) : null })}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">Not set</option>
                <option value="1">1 - Trivial</option>
                <option value="2">2 - Small</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - Large</option>
                <option value="5">5 - Huge</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Impact</label>
              <select
                value={form.impact ?? ''}
                onChange={(e) => setForm({ ...form, impact: e.target.value ? Number(e.target.value) : null })}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">Not set</option>
                <option value="1">1 - Minimal</option>
                <option value="2">2 - Low</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - High</option>
                <option value="5">5 - Critical</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Assign to</label>
              <select
                value={form.assigned_agent_id}
                onChange={(e) => {
                  if (e.target.value === '__add_new__') {
                    setShowAgentModal(true);
                  } else {
                    setForm({ ...form, assigned_agent_id: e.target.value });
                  }
                }}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}{agent.role ? ` — ${agent.role.slice(0, 40)}${agent.role.length > 40 ? '…' : ''}` : ''}
                  </option>
                ))}
                <option value="__add_new__" className="text-mc-accent">
                  + Add new agent...
                </option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Milestone</label>
              <select
                value={form.milestone_id}
                onChange={(e) => setForm({ ...form, milestone_id: e.target.value })}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">No milestone</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {saveError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md">
              <span className="text-sm text-red-400">{saveError}</span>
            </div>
          )}
            </form>
          )}

          {/* Planning Tab */}
          {activeTab === 'planning' && task && (
            <PlanningTab
              taskId={task.id}
              onSpecLocked={handleSpecLocked}
            />
          )}

          {/* Team Tab */}
          {activeTab === 'team' && task && (
            <TeamTab taskId={task.id} workspaceId={workspaceId || task.workspace_id || 'default'} />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && task && (
            <ActivityLog taskId={task.id} />
          )}

          {/* Deliverables Tab */}
          {activeTab === 'deliverables' && task && (
            <DeliverablesList taskId={task.id} />
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && task && (
            <SessionsList taskId={task.id} />
          )}
        </div>

        {/* Footer - only show on overview tab */}
        {activeTab === 'overview' && (
          <div className="flex items-center justify-between p-4 border-t border-mc-border flex-shrink-0">
            <div className="flex gap-2">
              {task && (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="min-h-11 flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text"
              >
                Cancel
              </button>
              {!task && (
                <button
                  onClick={(e) => handleSubmit(e, true)}
                  disabled={isSubmitting}
                  className="min-h-11 flex items-center gap-2 px-4 py-2 border border-mc-accent text-mc-accent rounded text-sm font-medium hover:bg-mc-accent/10 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {isSubmitting ? 'Saving...' : 'Save & New'}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="min-h-11 flex items-center gap-2 px-4 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nested Agent Modal for inline agent creation */}
      {showAgentModal && (
        <AgentModal
          workspaceId={workspaceId}
          onClose={() => setShowAgentModal(false)}
          onAgentCreated={(agentId) => {
            // Auto-select the newly created agent
            setForm({ ...form, assigned_agent_id: agentId });
            setShowAgentModal(false);
          }}
        />
      )}
    </div>
  );
}
