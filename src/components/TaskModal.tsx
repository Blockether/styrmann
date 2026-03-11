'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Save, Trash2, Activity, Package, Bot, Plus, Upload } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { DeliverablesList } from './DeliverablesList';
import { SessionsList } from './SessionsList';
import { PlanningTab } from './PlanningTab';
import { CreateMilestoneModal } from './CreateMilestoneModal';
import type { Task, TaskPriority, TaskStatus, TaskType, GitHubIssue, Human, HimalayaStatus } from '@/lib/types';

type TabType = 'overview' | 'activity' | 'deliverables' | 'sessions';

interface TaskModalProps {
  task?: Task;
  onClose: () => void;
  workspaceId?: string;
  defaultSprintId?: string;
  defaultMilestoneId?: string;
  githubIssue?: GitHubIssue;
  defaultTab?: TabType;
  onTabChange?: (tab: TabType) => void;
}

export function TaskModal({ task, onClose, workspaceId, defaultSprintId: _defaultSprintId, defaultMilestoneId, githubIssue, defaultTab, onTabChange }: TaskModalProps) {
  const { agents, addTask, updateTask, addEvent } = useMissionControl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingAcceptance, setIsProcessingAcceptance] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab || 'overview');
  const contentRef = useRef<HTMLDivElement>(null);
  const taskFileInputRef = useRef<HTMLInputElement>(null);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const [form, setForm] = useState({
    title: githubIssue?.title || task?.title || '',
    description: githubIssue?.body || task?.description || '',
    priority: task?.priority || 'normal' as TaskPriority,
    status: task?.status || 'inbox' as TaskStatus,
    assignee_type: task?.assignee_type || 'ai' as 'ai' | 'human',
    assigned_agent_id: task?.assigned_agent_id || '',
    assigned_human_id: task?.assigned_human_id || '',
    task_type: task?.task_type || 'feature' as TaskType,
    effort: task?.effort || null as number | null,
    impact: task?.impact || null as number | null,
    milestone_id: task?.milestone_id || defaultMilestoneId || '',
    github_issue_id: githubIssue?.id || task?.github_issue_id || null as string | null,
  });

  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>([]);
  const [newCriteriaInput, setNewCriteriaInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [milestones, setMilestones] = useState<{ id: string; name: string }[]>([]);
  const [humans, setHumans] = useState<Human[]>([]);
  const [himalayaStatus, setHimalayaStatus] = useState<HimalayaStatus | null>(null);
  const resolvedWorkspaceId = workspaceId || task?.workspace_id || 'default';

  const loadMilestones = useCallback(async () => {
    try {
      const res = await fetch(`/api/milestones?workspace_id=${resolvedWorkspaceId}`);
      const data = await res.json();
      setMilestones(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch {
      setMilestones([]);
      return [] as { id: string; name: string }[];
    }
  }, [resolvedWorkspaceId]);

  useEffect(() => {
    loadMilestones().catch(() => {});
  }, [loadMilestones]);

  useEffect(() => {
    fetch('/api/humans').then((res) => res.json()).then((data) => {
      if (Array.isArray(data)) setHumans(data);
    }).catch(() => {});
    fetch('/api/system/himalaya').then((res) => res.json()).then((data) => setHimalayaStatus(data)).catch(() => {});
  }, []);

  const resolveStatus = (): TaskStatus => {
    if (!task) {
      if (form.assignee_type === 'human' && form.assigned_human_id) return 'assigned';
      return 'inbox';
    }
    if (task.status === 'inbox' && ((form.assignee_type === 'human' && form.assigned_human_id) || (form.assignee_type === 'ai' && form.assigned_agent_id))) return 'assigned';
    return form.status;
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const uploadAttachedFiles = async (taskId: string): Promise<void> => {
    if (attachedFiles.length === 0) return;

    for (const file of attachedFiles) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      formData.append('resource_type', 'document');

      const res = await fetch(`/api/tasks/${taskId}/resources`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to upload attachment' }));
        throw new Error(errData.error || `Failed to upload ${file.name}`);
      }
    }
  };

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
        assigned_agent_id: task ? (form.assigned_agent_id || null) : null,
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
        await uploadAttachedFiles(savedTask.id);
        // Editing existing task
        updateTask(savedTask);

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

      await uploadAttachedFiles(savedTask.id);

      if (keepOpen) {
        setForm({
          title: '',
          description: '',
          priority: 'normal' as TaskPriority,
          status: 'inbox' as TaskStatus,
          assignee_type: 'ai' as 'ai' | 'human',
          assigned_agent_id: '',
          assigned_human_id: '',
          task_type: 'feature' as TaskType,
          effort: null,
          impact: null,
          milestone_id: defaultMilestoneId || '',
          github_issue_id: null,
        });
        setAcceptanceCriteria([]);
        setNewCriteriaInput('');
        setAttachedFiles([]);
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

  const handleAcceptAndMerge = async () => {
    if (!task) return;
    setIsProcessingAcceptance(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || data.message || `Accept failed (${res.status})`);
        return;
      }

      if (data.task) {
        updateTask(data.task);
      }

      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Accept failed');
    } finally {
      setIsProcessingAcceptance(false);
    }
  };

  const handleRaiseProblem = async () => {
    if (!task) return;
    const reason = window.prompt('Describe the problem to send the task back for rework:');
    if (!reason || !reason.trim()) return;

    setIsProcessingAcceptance(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/tasks/${task.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: reason.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || data.message || `Reject failed (${res.status})`);
        return;
      }

      const refreshed = await fetch(`/api/tasks/${task.id}`);
      if (refreshed.ok) {
        const refreshedTask = await refreshed.json();
        updateTask(refreshedTask);
      }

      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Reject failed');
    } finally {
      setIsProcessingAcceptance(false);
    }
  };

  const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: null },
    { id: 'activity' as TabType, label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'sessions' as TabType, label: 'Sessions', icon: <Bot className="w-4 h-4" /> },
    { id: 'deliverables' as TabType, label: 'Deliverables', icon: <Package className="w-4 h-4" /> },
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
                onClick={() => handleTabChange(tab.id)}
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
        <div ref={contentRef} className="flex-1 overflow-y-auto p-2 sm:p-4">
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
              className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
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

          <div>
            <label className="block text-sm font-medium mb-1">Files for Agent Context</label>
            <div className="space-y-2">
              <div
                className="border-2 border-dashed border-mc-border rounded p-4 text-center cursor-pointer hover:bg-mc-bg-tertiary"
                onClick={() => taskFileInputRef.current?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length > 0) setAttachedFiles((prev) => [...prev, ...files]);
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                <Upload className="w-6 h-6 mx-auto text-mc-text-secondary mb-2" />
                <div className="text-sm text-mc-text-secondary">Drag files here or click to browse</div>
                <input
                  ref={taskFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) setAttachedFiles((prev) => [...prev, ...files]);
                    e.currentTarget.value = '';
                  }}
                />
              </div>
              <p className="text-xs text-mc-text-secondary">
                Attached files are stored under this task&apos;s `.mission-control` resource directory and automatically ingested into dispatch prompts for agent runs.
              </p>
              {attachedFiles.length > 0 && (
                <div className="space-y-1">
                  {attachedFiles.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 text-xs bg-mc-bg border border-mc-border rounded px-2 py-1">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== index))}
                        className="text-mc-text-secondary hover:text-mc-accent-red"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  className="flex-1 min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
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
                  className="min-h-10 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Task Type</label>
              <select
                value={form.task_type}
                onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
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
                className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Effort</label>
              <select
                value={form.effort ?? ''}
                onChange={(e) => setForm({ ...form, effort: e.target.value ? Number(e.target.value) : null })}
                className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
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
                className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
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

          <div className={`grid grid-cols-1 ${task ? 'sm:grid-cols-2' : ''} gap-4`}>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Assignee Type</label>
                <div className="inline-grid w-full max-w-xs grid-cols-2 gap-1 rounded-lg border border-mc-border bg-mc-bg p-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, assignee_type: 'ai', assigned_human_id: '' })}
                    className={`min-h-9 w-full px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${form.assignee_type === 'ai' ? 'bg-mc-accent text-mc-bg' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}
                  >
                    AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, assignee_type: 'human', assigned_agent_id: '' })}
                    className={`min-h-9 w-full px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${form.assignee_type === 'human' ? 'bg-mc-accent text-mc-bg' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}
                  >
                    Human
                  </button>
                </div>
              </div>

              {form.assignee_type === 'human' ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Human Assignee</label>
                  <select
                    value={form.assigned_human_id}
                    onChange={(e) => setForm({ ...form, assigned_human_id: e.target.value })}
                    className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
                  >
                    <option value="">Select human</option>
                    {humans.map((human) => (
                      <option key={human.id} value={human.id}>{human.name} — {human.email}</option>
                    ))}
                  </select>
                  {himalayaStatus && (!himalayaStatus.installed || !himalayaStatus.configured || !himalayaStatus.healthy_account) && (
                    <div className="mt-2 text-xs text-mc-accent-red bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                      Human assignment mail is not ready: {himalayaStatus.error || 'Himalaya is not configured.'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-mc-text-secondary bg-mc-bg border border-mc-border rounded px-3 py-2">
                  AI tasks are planned by the orchestrator from existing agents and shared skills. Direct agent picking is removed from the overview form.
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Milestone</label>
              <select
                value={form.milestone_id}
                onChange={(e) => {
                  if (e.target.value === '__add_new__') {
                    setShowMilestoneModal(true);
                    return;
                  }
                  setForm({ ...form, milestone_id: e.target.value });
                }}
                className="w-full min-h-10 bg-mc-bg border border-mc-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">No milestone</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
                <option value="__add_new__" className="text-mc-accent">
                  + Add new milestone...
                </option>
              </select>
            </div>
          </div>

          {!task && form.assignee_type === 'ai' && (
            <div className="text-xs text-mc-text-secondary bg-mc-bg border border-mc-border rounded px-3 py-2">
              AI tasks are planned automatically by the orchestrator using existing agents and linked skills. Manual workflow configuration is disabled.
            </div>
          )}

          {saveError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md">
              <span className="text-sm text-red-400">{saveError}</span>
            </div>
          )}
            </form>
          )}

          {activeTab === 'activity' && task && (
            <PlanningTab taskId={task.id} />
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && task && (
            <SessionsList taskId={task.id} />
          )}

          {/* Deliverables Tab */}
          {activeTab === 'deliverables' && task && (
            <DeliverablesList taskId={task.id} />
          )}
        </div>

        {/* Footer - only show on overview tab */}
        {activeTab === 'overview' && (
          <div className="p-3 border-t border-mc-border flex-shrink-0 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 px-3 py-2 text-sm text-mc-text-secondary hover:text-mc-text rounded"
              >
                Cancel
              </button>
              {task && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {task && ['review', 'verification'].includes(task.status) && (
                <>
                  <button
                    type="button"
                    onClick={handleRaiseProblem}
                    disabled={isProcessingAcceptance}
                    className="min-h-11 px-3 py-2 border border-mc-accent-red text-mc-accent-red rounded text-sm font-medium hover:bg-mc-accent-red/10 disabled:opacity-50"
                  >
                    <span className="hidden sm:inline">Raise Problem</span>
                    <span className="sm:hidden">Problem</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptAndMerge}
                    disabled={isProcessingAcceptance}
                    className="min-h-11 px-3 py-2 bg-mc-accent-green text-white rounded text-sm font-medium hover:bg-mc-accent-green/90 disabled:opacity-50"
                  >
                    {isProcessingAcceptance ? 'Processing...' : 'Accept'}
                  </button>
                </>
              )}
              {!task && (
                <button
                  onClick={(e) => handleSubmit(e, true)}
                  disabled={isSubmitting}
                  className="min-h-11 flex items-center gap-1.5 px-3 py-2 border border-mc-accent text-mc-accent rounded text-sm font-medium hover:bg-mc-accent/10 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">{isSubmitting ? 'Saving...' : 'Save & New'}</span>
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="min-h-11 flex items-center gap-1.5 px-3 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">{isSubmitting ? 'Saving...' : 'Save'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showMilestoneModal && (
        <CreateMilestoneModal
          workspaceId={resolvedWorkspaceId}
          agents={agents}
          onClose={() => setShowMilestoneModal(false)}
          onCreated={(milestoneId) => {
            loadMilestones().then((items) => {
              if (milestoneId) {
                setForm((prev) => ({ ...prev, milestone_id: milestoneId }));
                return;
              }
              const latestId = items[0]?.id;
              if (latestId) {
                setForm((prev) => ({ ...prev, milestone_id: latestId }));
              }
            }).catch(() => {});
            setShowMilestoneModal(false);
          }}
        />
      )}
    </div>
  );
}
