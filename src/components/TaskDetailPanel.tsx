'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronDown,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  ExternalLink,
  Link2,
  FileText,
  Layers,
  Hash,
  Globe,
  Code,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import type {
  Task,
  TaskType,
  TaskPriority,
  TaskStatus,
  TaskComment,
  TaskBlocker,
  TaskResource,
  TaskAcceptanceCriteria,
  Tag,
  Sprint,
  Milestone,
  Agent,
  ResourceType,
} from '@/lib/types';

const TASK_TYPE_COLORS: Record<TaskType, string> = {
  bug: 'bg-mc-accent-red text-white',
  feature: 'bg-blue-500 text-white',
  chore: 'bg-mc-text-secondary text-white',
  documentation: 'bg-mc-accent-purple text-white',
  research: 'bg-mc-accent-green text-white',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-mc-text-secondary/20 text-mc-text-secondary',
  normal: 'bg-mc-accent/20 text-mc-accent',
  high: 'bg-mc-accent-yellow/20 text-mc-accent-yellow',
  urgent: 'bg-mc-accent-red/20 text-mc-accent-red',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  planning: 'bg-purple-500/20 text-purple-700',
  pending_dispatch: 'bg-purple-500/20 text-purple-700',
  inbox: 'bg-mc-accent-pink/20 text-mc-accent',
  assigned: 'bg-mc-accent-yellow/20 text-mc-accent-yellow',
  in_progress: 'bg-mc-accent/20 text-mc-accent',
  testing: 'bg-mc-accent-cyan/20 text-mc-accent-cyan',
  review: 'bg-mc-accent-purple/20 text-mc-accent-purple',
  verification: 'bg-orange-500/20 text-orange-700',
  done: 'bg-mc-accent-green/20 text-mc-accent-green',
};

const RESOURCE_TYPE_ICONS: Record<ResourceType, React.ReactNode> = {
  link: <Globe className="w-3 h-3" />,
  document: <FileText className="w-3 h-3" />,
  design: <Layers className="w-3 h-3" />,
  api: <Code className="w-3 h-3" />,
  reference: <BookOpen className="w-3 h-3" />,
};

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}

function CollapsibleSection({ title, defaultOpen = true, children, badge }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-mc-border last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 hover:bg-mc-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-mc-text-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          )}
          <span className="font-medium text-sm">{title}</span>
          {badge !== undefined && (
            <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">
              {badge}
            </span>
          )}
        </div>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function EffortImpactDots({ value, max = 5, label }: { value: number | undefined; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-mc-text-secondary w-12">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full ${
              i < (value ?? 0) ? 'bg-mc-accent' : 'bg-mc-border'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-mc-border/50 rounded ${className}`} />;
}

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [blockers, setBlockers] = useState<TaskBlocker[]>([]);
  const [resources, setResources] = useState<TaskResource[]>([]);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<TaskAcceptanceCriteria[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [newBlockerDesc, setNewBlockerDesc] = useState('');
  const [submittingBlocker, setSubmittingBlocker] = useState(false);

  const [newResourceTitle, setNewResourceTitle] = useState('');
  const [newResourceUrl, setNewResourceUrl] = useState('');
  const [newResourceType, setNewResourceType] = useState<ResourceType>('link');
  const [submittingResource, setSubmittingResource] = useState(false);

  const [newCriteriaDesc, setNewCriteriaDesc] = useState('');
  const [submittingCriteria, setSubmittingCriteria] = useState(false);

  const [addingTagId, setAddingTagId] = useState('');

  useEffect(() => {
    const loadTask = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) throw new Error('Failed to load task');
        const data: Task = await res.json();
        setTask(data);
        setTitleInput(data.title);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [taskId]);

  useEffect(() => {
    if (!task) return;

    const workspaceId = task.workspace_id;

    const loadMetadata = async () => {
      try {
        const [sprintsRes, milestonesRes, agentsRes, tagsRes] = await Promise.all([
          fetch(`/api/sprints?workspace_id=${workspaceId}`),
          fetch(`/api/milestones?workspace_id=${workspaceId}`),
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/tags?workspace_id=${workspaceId}`),
        ]);

        if (sprintsRes.ok) setSprints(await sprintsRes.json());
        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tagsRes.ok) setAvailableTags(await tagsRes.json());
      } catch (err) {
        console.error('Failed to load metadata:', err);
      }
    };

    const loadSubResources = async () => {
      try {
        const [commentsRes, blockersRes, resourcesRes, criteriaRes, tagsRes, subtasksRes] = await Promise.all([
          fetch(`/api/tasks/${taskId}/comments`),
          fetch(`/api/tasks/${taskId}/blockers`),
          fetch(`/api/tasks/${taskId}/resources`),
          fetch(`/api/tasks/${taskId}/acceptance-criteria`),
          fetch(`/api/tasks/${taskId}/tags`),
          fetch(`/api/tasks?parent_task_id=${taskId}`),
        ]);

        if (commentsRes.ok) setComments(await commentsRes.json());
        if (blockersRes.ok) setBlockers(await blockersRes.json());
        if (resourcesRes.ok) setResources(await resourcesRes.json());
        if (criteriaRes.ok) setAcceptanceCriteria(await criteriaRes.json());
        if (tagsRes.ok) setTaskTags(await tagsRes.json());
        if (subtasksRes.ok) setSubtasks(await subtasksRes.json());
      } catch (err) {
        console.error('Failed to load sub-resources:', err);
      }
    };

    loadMetadata();
    loadSubResources();
  }, [task, taskId]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const updateTask = async (updates: Partial<Task>) => {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (res.ok) {
      const updated = await res.json();
      setTask(updated);
      return true;
    }
    return false;
  };

  const handleTitleSave = async () => {
    if (!titleInput.trim() || titleInput === task?.title) {
      setEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    const success = await updateTask({ title: titleInput.trim() });
    if (success) {
      setEditingTitle(false);
    }
    setSavingTitle(false);
  };

  const handleEffortChange = async (effort: number) => {
    await updateTask({ effort });
  };

  const handleImpactChange = async (impact: number) => {
    await updateTask({ impact });
  };

  const handleSprintChange = async (sprintId: string) => {
    await updateTask({ sprint_id: sprintId || undefined });
  };

  const handleMilestoneChange = async (milestoneId: string) => {
    await updateTask({ milestone_id: milestoneId || undefined });
  };

  const handleAssigneeChange = async (agentId: string) => {
    await updateTask({ assigned_agent_id: agentId || undefined });
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment.trim(), author: 'User' }),
      });

      if (res.ok) {
        const comment = await res.json();
        setComments(prev => [...prev, comment]);
        setNewComment('');
      }
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleAddBlocker = async () => {
    if (!newBlockerDesc.trim()) return;

    setSubmittingBlocker(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/blockers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newBlockerDesc.trim() }),
      });

      if (res.ok) {
        const blocker = await res.json();
        setBlockers(prev => [...prev, blocker]);
        setNewBlockerDesc('');
      }
    } catch (err) {
      console.error('Failed to add blocker:', err);
    } finally {
      setSubmittingBlocker(false);
    }
  };

  const handleResolveBlocker = async (blockerId: string, resolved: boolean) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/blockers/${blockerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved }),
      });

      if (res.ok) {
        setBlockers(prev =>
          prev.map(b => b.id === blockerId ? { ...b, resolved } : b)
        );
      }
    } catch (err) {
      console.error('Failed to update blocker:', err);
    }
  };

  const handleAddResource = async () => {
    if (!newResourceUrl.trim()) return;

    setSubmittingResource(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newResourceTitle.trim() || newResourceUrl.trim(),
          url: newResourceUrl.trim(),
          resource_type: newResourceType,
        }),
      });

      if (res.ok) {
        const resource = await res.json();
        setResources(prev => [...prev, resource]);
        setNewResourceTitle('');
        setNewResourceUrl('');
        setNewResourceType('link');
      }
    } catch (err) {
      console.error('Failed to add resource:', err);
    } finally {
      setSubmittingResource(false);
    }
  };

  const handleDeleteResource = async (resourceId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/resources/${resourceId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setResources(prev => prev.filter(r => r.id !== resourceId));
      }
    } catch (err) {
      console.error('Failed to delete resource:', err);
    }
  };

  const handleAddCriteria = async () => {
    if (!newCriteriaDesc.trim()) return;

    setSubmittingCriteria(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/acceptance-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newCriteriaDesc.trim() }),
      });

      if (res.ok) {
        const criteria = await res.json();
        setAcceptanceCriteria(prev => [...prev, criteria]);
        setNewCriteriaDesc('');
      }
    } catch (err) {
      console.error('Failed to add criteria:', err);
    } finally {
      setSubmittingCriteria(false);
    }
  };

  const handleToggleCriteria = async (criteriaId: string, isMet: boolean) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/acceptance-criteria/${criteriaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_met: isMet }),
      });

      if (res.ok) {
        setAcceptanceCriteria(prev =>
          prev.map(c => c.id === criteriaId ? { ...c, is_met: isMet } : c)
        );
      }
    } catch (err) {
      console.error('Failed to update criteria:', err);
    }
  };

  const handleAddTag = async () => {
    if (!addingTagId) return;

    try {
      const res = await fetch(`/api/tasks/${taskId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: addingTagId }),
      });

      if (res.ok) {
        const tag = availableTags.find(t => t.id === addingTagId);
        if (tag) {
          setTaskTags(prev => [...prev, tag]);
        }
        setAddingTagId('');
      }
    } catch (err) {
      console.error('Failed to add tag:', err);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tagId }),
      });

      if (res.ok) {
        setTaskTags(prev => prev.filter(t => t.id !== tagId));
      }
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  const paretoScore = task?.effort && task?.impact
    ? (task.impact / task.effort).toFixed(2)
    : null;

  return (
    <div
      data-component="src/components/TaskDetailPanel"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative w-full max-w-[480px] h-full bg-mc-bg-secondary border-l border-mc-border flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <div className="flex items-center gap-2">
            {task && (
              <span className={`px-2 py-0.5 rounded text-xs uppercase ${TASK_TYPE_COLORS[task.task_type]}`}>
                {task.task_type}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-xs uppercase ${task ? PRIORITY_COLORS[task.priority] : ''}`}>
              {task?.priority}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs uppercase ${task ? STATUS_COLORS[task.status] : ''}`}>
              {task?.status?.replace('_', ' ')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="flex items-center gap-2 text-mc-accent-red">
                <AlertTriangle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          ) : task ? (
            <div>
              <div className="p-4 border-b border-mc-border">
                {editingTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-lg font-semibold focus:outline-none focus:border-mc-accent"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTitleSave();
                        if (e.key === 'Escape') {
                          setEditingTitle(false);
                          setTitleInput(task.title);
                        }
                      }}
                    />
                    <button
                      onClick={handleTitleSave}
                      disabled={savingTitle}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                    >
                      {savingTitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                  </div>
                ) : (
                  <h2
                    onClick={() => setEditingTitle(true)}
                    className="text-lg font-semibold cursor-pointer hover:text-mc-accent"
                  >
                    {task.title}
                  </h2>
                )}
              </div>

              <div className="p-4 border-b border-mc-border bg-mc-bg-tertiary/30">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEffortChange(Math.max(1, (task.effort ?? 3) - 1))}
                      className="w-6 h-6 flex items-center justify-center text-mc-text-secondary hover:text-mc-text"
                    >
                      -
                    </button>
                    <EffortImpactDots value={task.effort} label="Effort" />
                    <button
                      onClick={() => handleEffortChange(Math.min(5, (task.effort ?? 3) + 1))}
                      className="w-6 h-6 flex items-center justify-center text-mc-text-secondary hover:text-mc-text"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleImpactChange(Math.max(1, (task.impact ?? 3) - 1))}
                      className="w-6 h-6 flex items-center justify-center text-mc-text-secondary hover:text-mc-text"
                    >
                      -
                    </button>
                    <EffortImpactDots value={task.impact} label="Impact" />
                    <button
                      onClick={() => handleImpactChange(Math.min(5, (task.impact ?? 3) + 1))}
                      className="w-6 h-6 flex items-center justify-center text-mc-text-secondary hover:text-mc-text"
                    >
                      +
                    </button>
                  </div>
                  {paretoScore && (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-xs text-mc-text-secondary">Pareto Score</span>
                      <span className={`px-2 py-1 rounded text-sm font-bold ${
                        parseFloat(paretoScore) >= 2
                          ? 'bg-mc-accent-green/20 text-mc-accent-green'
                          : parseFloat(paretoScore) >= 1
                            ? 'bg-mc-accent/20 text-mc-accent'
                            : 'bg-mc-accent-yellow/20 text-mc-accent-yellow'
                      }`}>
                        {paretoScore}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <CollapsibleSection title="Description" defaultOpen={!!task.description}>
                {task.description ? (
                  <div className="whitespace-pre-wrap text-sm text-mc-text-secondary">
                    {task.description}
                  </div>
                ) : (
                  <p className="text-sm text-mc-text-secondary italic">No description provided</p>
                )}
              </CollapsibleSection>

              <CollapsibleSection title="Sprint & Milestone">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-mc-text-secondary w-20">Sprint</span>
                    <select
                      value={task.sprint_id || ''}
                      onChange={(e) => handleSprintChange(e.target.value)}
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      <option value="">No sprint</option>
                      {sprints.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-mc-text-secondary w-20">Milestone</span>
                    <select
                      value={task.milestone_id || ''}
                      onChange={(e) => handleMilestoneChange(e.target.value)}
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      <option value="">No milestone</option>
                      {milestones.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Assignee">
                <div className="flex items-center gap-2">
                  <select
                    value={task.assigned_agent_id || ''}
                    onChange={(e) => handleAssigneeChange(e.target.value)}
                    className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                  >
                    <option value="">Unassigned</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name} - {a.role}</option>
                    ))}
                  </select>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Tags" badge={taskTags.length}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {taskTags.map(tag => (
                      <div
                        key={tag.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}50`, borderWidth: 1 }}
                      >
                        {tag.name}
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="ml-1 hover:opacity-70"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={addingTagId}
                      onChange={(e) => setAddingTagId(e.target.value)}
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      <option value="">Add tag...</option>
                      {availableTags.filter(t => !taskTags.some(tt => tt.id === t.id)).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddTag}
                      disabled={!addingTagId}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Acceptance Criteria" badge={acceptanceCriteria.length} defaultOpen={acceptanceCriteria.length > 0}>
                <div className="space-y-3">
                  {acceptanceCriteria.map(criteria => (
                    <div
                      key={criteria.id}
                      className="flex items-start gap-2 p-2 bg-mc-bg rounded border border-mc-border"
                    >
                      <button
                        onClick={() => handleToggleCriteria(criteria.id, !criteria.is_met)}
                        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          criteria.is_met
                            ? 'bg-mc-accent-green text-white'
                            : 'bg-mc-bg-tertiary border border-mc-border'
                        }`}
                      >
                        {criteria.is_met && <Check className="w-3 h-3" />}
                      </button>
                      <span className={`text-sm ${criteria.is_met ? 'line-through text-mc-text-secondary' : ''}`}>
                        {criteria.description}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCriteriaDesc}
                      onChange={(e) => setNewCriteriaDesc(e.target.value)}
                      placeholder="Add acceptance criteria..."
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCriteria();
                      }}
                    />
                    <button
                      onClick={handleAddCriteria}
                      disabled={!newCriteriaDesc.trim() || submittingCriteria}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                    >
                      {submittingCriteria ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Blockers" badge={blockers.filter(b => !b.resolved).length} defaultOpen={blockers.length > 0}>
                <div className="space-y-3">
                  {blockers.map(blocker => (
                    <div
                      key={blocker.id}
                      className={`flex items-start gap-2 p-2 rounded border ${
                        blocker.resolved
                          ? 'bg-mc-bg border-mc-border'
                          : 'bg-mc-accent-red/10 border-mc-accent-red/30'
                      }`}
                    >
                      <button
                        onClick={() => handleResolveBlocker(blocker.id, !blocker.resolved)}
                        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          blocker.resolved
                            ? 'bg-mc-accent-green text-white'
                            : 'bg-mc-accent-red/20 text-mc-accent-red border border-mc-accent-red/30'
                        }`}
                      >
                        {blocker.resolved ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${blocker.resolved ? 'line-through text-mc-text-secondary' : ''}`}>
                          {blocker.description || `Blocked by task: ${blocker.blocked_by_task?.title || 'Unknown'}`}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newBlockerDesc}
                      onChange={(e) => setNewBlockerDesc(e.target.value)}
                      placeholder="Add blocker..."
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddBlocker();
                      }}
                    />
                    <button
                      onClick={handleAddBlocker}
                      disabled={!newBlockerDesc.trim() || submittingBlocker}
                      className="min-h-11 px-3 bg-mc-accent-red text-white rounded text-sm hover:bg-mc-accent-red/90 disabled:opacity-50"
                    >
                      {submittingBlocker ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Resources" badge={resources.length} defaultOpen={resources.length > 0}>
                <div className="space-y-3">
                  {resources.map(resource => (
                    <div
                      key={resource.id}
                      className="flex items-center gap-2 p-2 bg-mc-bg rounded border border-mc-border"
                    >
                      <div className="w-8 h-8 rounded bg-mc-bg-tertiary flex items-center justify-center text-mc-text-secondary">
                        {RESOURCE_TYPE_ICONS[resource.resource_type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{resource.title}</p>
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-mc-accent hover:underline truncate block"
                        >
                          {resource.url}
                        </a>
                      </div>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleDeleteResource(resource.id)}
                        className="p-1.5 hover:bg-mc-accent-red/10 rounded text-mc-text-secondary hover:text-mc-accent-red"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="space-y-2 pt-2 border-t border-mc-border">
                    <input
                      type="text"
                      value={newResourceTitle}
                      onChange={(e) => setNewResourceTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    />
                    <input
                      type="url"
                      value={newResourceUrl}
                      onChange={(e) => setNewResourceUrl(e.target.value)}
                      placeholder="URL"
                      className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={newResourceType}
                        onChange={(e) => setNewResourceType(e.target.value as ResourceType)}
                        className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                      >
                        <option value="link">Link</option>
                        <option value="document">Document</option>
                        <option value="design">Design</option>
                        <option value="api">API</option>
                        <option value="reference">Reference</option>
                      </select>
                      <button
                        onClick={handleAddResource}
                        disabled={!newResourceUrl.trim() || submittingResource}
                        className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                      >
                        {submittingResource ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Comments" badge={comments.length} defaultOpen={comments.length > 0}>
                <div className="space-y-3">
                  {comments.map(comment => (
                    <div key={comment.id} className="p-2 bg-mc-bg rounded border border-mc-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-mc-accent">{comment.author}</span>
                        <span className="text-[10px] text-mc-text-secondary">
                          {new Date(comment.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-mc-text">{comment.content}</p>
                    </div>
                  ))}
                  <div className="flex items-start gap-2">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      rows={2}
                      className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none"
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment.trim() || submittingComment}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                    >
                      {submittingComment ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <MessageSquare className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Subtasks" badge={subtasks.length} defaultOpen={subtasks.length > 0}>
                {subtasks.length > 0 ? (
                  <div className="space-y-2">
                    {subtasks.map(subtask => (
                      <div
                        key={subtask.id}
                        className="flex items-center gap-2 p-2 bg-mc-bg rounded border border-mc-border"
                      >
                        <span className={`px-2 py-0.5 rounded text-xs uppercase ${TASK_TYPE_COLORS[subtask.task_type]}`}>
                          {subtask.task_type}
                        </span>
                        <span className="flex-1 text-sm truncate">{subtask.title}</span>
                        <span className={`px-2 py-0.5 rounded text-xs uppercase ${STATUS_COLORS[subtask.status]}`}>
                          {subtask.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-mc-text-secondary italic">No subtasks</p>
                )}
              </CollapsibleSection>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
