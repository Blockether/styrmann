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
  TaskDependency,
  TaskResource,
  TaskAcceptanceCriteria,
  Tag,
  Sprint,
  Milestone,
  Agent,
  Human,
  ResourceType,
} from '@/lib/types';

const TASK_TYPE_COLORS: Record<TaskType, string> = {
  bug: 'bg-mc-accent-red text-white',
  feature: 'bg-blue-500 text-white',
  chore: 'bg-mc-text-secondary text-white',
  documentation: 'bg-mc-accent-purple text-white',
  research: 'bg-mc-accent-green text-white',
  spike: 'bg-orange-500 text-white',
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  bug: 'bug',
  feature: 'feature',
  chore: 'chore',
  documentation: 'documentation',
  research: 'research',
  spike: 'spike',
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
    <div className="mx-3 mb-3 overflow-hidden rounded-[1.1rem] border border-mc-border bg-gradient-to-br from-white via-[#fff9ee] to-[#f7f0e2] shadow-[0_16px_36px_-34px_rgba(0,0,0,0.22)] last:mb-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-mc-text-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          )}
          <span className="font-medium text-sm">{title}</span>
          {badge !== undefined && (
            <span className="text-xs bg-white/80 border border-mc-border px-2 py-0.5 rounded-full text-mc-text-secondary">
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

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [humans, setHumans] = useState<Human[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [blockers, setBlockers] = useState<TaskBlocker[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [resources, setResources] = useState<TaskResource[]>([]);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<TaskAcceptanceCriteria[]>([]);
  const [taskTags, setTaskTags] = useState<Tag[]>([]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [newBlockerDesc, setNewBlockerDesc] = useState('');
  const [submittingBlocker, setSubmittingBlocker] = useState(false);
  const [newDependencyTaskId, setNewDependencyTaskId] = useState('');
  const [newDependencyStatus, setNewDependencyStatus] = useState<TaskStatus>('done');
  const [submittingDependency, setSubmittingDependency] = useState(false);

  const [newResourceTitle, setNewResourceTitle] = useState('');
  const [newResourceUrl, setNewResourceUrl] = useState('');
  const [newResourceType, setNewResourceType] = useState<ResourceType>('link');
  const [submittingResource, setSubmittingResource] = useState(false);

  const [newCriteriaDesc, setNewCriteriaDesc] = useState('');
  const [newCriteriaStatus, setNewCriteriaStatus] = useState<TaskStatus>('done');
  const [newCriteriaGateType, setNewCriteriaGateType] = useState<'manual' | 'artifact' | 'test' | 'deploy' | 'verifier'>('manual');
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
        const [milestonesRes, agentsRes, humansRes, tagsRes] = await Promise.all([
          fetch(`/api/milestones?workspace_id=${workspaceId}`),
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch('/api/humans'),
          fetch(`/api/tags?workspace_id=${workspaceId}`),
        ]);

        if (milestonesRes.ok) setMilestones(await milestonesRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (humansRes.ok) setHumans(await humansRes.json());
        if (tagsRes.ok) setAvailableTags(await tagsRes.json());
      } catch (err) {
        console.error('Failed to load metadata:', err);
      }
    };

    const loadSubResources = async () => {
      try {
        const [commentsRes, blockersRes, dependenciesRes, resourcesRes, criteriaRes, tagsRes] = await Promise.all([
          fetch(`/api/tasks/${taskId}/comments`),
          fetch(`/api/tasks/${taskId}/blockers`),
          fetch(`/api/tasks/${taskId}/dependencies`),
          fetch(`/api/tasks/${taskId}/resources`),
          fetch(`/api/tasks/${taskId}/acceptance-criteria`),
          fetch(`/api/tasks/${taskId}/tags`),
        ]);

        if (commentsRes.ok) setComments(await commentsRes.json());
        if (blockersRes.ok) setBlockers(await blockersRes.json());
        if (dependenciesRes.ok) setDependencies(await dependenciesRes.json());
        if (resourcesRes.ok) setResources(await resourcesRes.json());
        if (criteriaRes.ok) setAcceptanceCriteria(await criteriaRes.json());
        if (tagsRes.ok) setTaskTags(await tagsRes.json());
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


  const handleMilestoneChange = async (milestoneId: string) => {
    await updateTask({ milestone_id: milestoneId || undefined });
  };

  const handleAssigneeTypeChange = async (assigneeType: 'ai' | 'human') => {
    await updateTask({ assignee_type: assigneeType });
  };

  const handleHumanAssigneeChange = async (humanId: string) => {
    await updateTask({ assignee_type: 'human', assigned_human_id: humanId || undefined });
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

  const handleAddDependency = async () => {
    if (!newDependencyTaskId.trim()) return;
    setSubmittingDependency(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depends_on_task_id: newDependencyTaskId.trim(),
          required_status: newDependencyStatus,
        }),
      });
      if (res.ok) {
        const dependency = await res.json();
        setDependencies((prev) => [dependency, ...prev]);
        setNewDependencyTaskId('');
        setNewDependencyStatus('done');
      }
    } catch (err) {
      console.error('Failed to add dependency:', err);
    } finally {
      setSubmittingDependency(false);
    }
  };

  const handleDeleteDependency = async (dependencyId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies/${dependencyId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setDependencies((prev) => prev.filter((dependency) => dependency.id !== dependencyId));
      }
    } catch (err) {
      console.error('Failed to delete dependency:', err);
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
        body: JSON.stringify({
          description: newCriteriaDesc.trim(),
          required_for_status: newCriteriaStatus,
          gate_type: newCriteriaGateType,
          create_subcriteria: true,
        }),
      });

      if (res.ok) {
        const refreshed = await fetch(`/api/tasks/${taskId}/acceptance-criteria`);
        if (refreshed.ok) {
          setAcceptanceCriteria(await refreshed.json());
        }
        setNewCriteriaDesc('');
        setNewCriteriaGateType('manual');
        setNewCriteriaStatus('done');
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(184,134,11,0.22),rgba(0,0,0,0.48)_52%)]" />

      <div className="relative w-full max-w-[520px] h-full bg-[linear-gradient(180deg,#fffaf0_0%,#f8f1e3_100%)] border-l border-mc-border flex flex-col animate-slide-in shadow-[-20px_0_60px_-40px_rgba(60,40,10,0.5)]">
        <div className="flex items-center justify-between p-4 border-b border-mc-border gap-2 bg-[linear-gradient(135deg,rgba(184,134,11,0.12),rgba(255,255,255,0.96)_42%,rgba(255,248,230,0.98))]">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {task && (
              <span className={`px-2 py-0.5 rounded-full text-xs uppercase flex-shrink-0 ${TASK_TYPE_COLORS[task.task_type]}`}>
                {TASK_TYPE_LABELS[task.task_type]}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-xs uppercase flex-shrink-0 ${task ? PRIORITY_COLORS[task.priority] : ''}`}>
              {task?.priority}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs uppercase flex-shrink-0 truncate ${task ? STATUS_COLORS[task.status] : ''}`}>
              {task?.status?.replace('_', ' ')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-mc-bg-tertiary rounded flex-shrink-0"
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
              <div className="p-4 border-b border-mc-border bg-white/70">
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

              <div className="mx-3 mt-3 rounded-[1.1rem] border border-mc-border bg-gradient-to-br from-white via-[#fff9ee] to-[#f7f0e2] p-4 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.22)]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2 flex-shrink-0">
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
                  <div className="flex items-center gap-2 flex-shrink-0">
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
                    <div className="flex items-center gap-2 flex-shrink-0">
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

              <div className="mt-3" />

              <CollapsibleSection title="Description" defaultOpen={!!task.description}>
                {task.description ? (
                  <div className="whitespace-pre-wrap text-sm text-mc-text-secondary">
                    {task.description}
                  </div>
                ) : (
                  <p className="text-sm text-mc-text-secondary italic">No description provided</p>
                )}
              </CollapsibleSection>

              <CollapsibleSection title="Milestone">
                <div className="space-y-3">
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
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAssigneeTypeChange('ai')}
                      className={`min-h-11 px-3 py-2 rounded border text-sm ${task.assignee_type !== 'human' ? 'border-mc-accent bg-mc-accent/10 text-mc-accent' : 'border-mc-border text-mc-text-secondary'}`}
                    >
                      AI
                    </button>
                    <button
                      onClick={() => handleAssigneeTypeChange('human')}
                      className={`min-h-11 px-3 py-2 rounded border text-sm ${task.assignee_type === 'human' ? 'border-mc-accent bg-mc-accent/10 text-mc-accent' : 'border-mc-border text-mc-text-secondary'}`}
                    >
                      Human
                    </button>
                  </div>
                  {task.assignee_type === 'human' ? (
                    <select
                      value={task.assigned_human_id || ''}
                      onChange={(e) => handleHumanAssigneeChange(e.target.value)}
                      className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      <option value="">Select human</option>
                      {humans.map((human) => (
                        <option key={human.id} value={human.id}>{human.name} - {human.email}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-mc-text-secondary bg-mc-bg border border-mc-border rounded px-3 py-2">
                      AI tasks use orchestrator-owned workflow planning. Direct agent selection is removed here.
                    </div>
                  )}
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Tags" badge={taskTags.length}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {taskTags.map(tag => (
                      <div
                        key={tag.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs max-w-full"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}50`, borderWidth: 1 }}
                      >
                        <span className="truncate">{tag.name}</span>
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="ml-1 hover:opacity-70 flex-shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <select
                      value={addingTagId}
                      onChange={(e) => setAddingTagId(e.target.value)}
                      className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent min-w-0"
                    >
                      <option value="">Add tag...</option>
                      {availableTags.filter(t => !taskTags.some(tt => tt.id === t.id)).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddTag}
                      disabled={!addingTagId}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50 flex-shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Acceptance Criteria" badge={acceptanceCriteria.length} defaultOpen={acceptanceCriteria.length > 0}>
                <div className="space-y-3">
                  {acceptanceCriteria.filter(c => !c.parent_criteria_id).map(criteria => {
                    const children = acceptanceCriteria.filter(c => c.parent_criteria_id === criteria.id);
                    return (
                      <div key={criteria.id} className="space-y-1">
                        <div className="flex items-start gap-2 p-2 bg-mc-bg rounded border border-mc-border">
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
                          <div className="min-w-0 flex-1">
                            <span className={`text-sm ${criteria.is_met ? 'line-through text-mc-text-secondary' : ''}`}>
                              {criteria.description}
                            </span>
                            <div className="text-[11px] text-mc-text-secondary mt-0.5">
                              Gate: {criteria.gate_type || 'manual'} • Required for {(criteria.required_for_status || 'done').replace(/_/g, ' ')}
                            </div>
                          </div>
                        </div>
                        {children.map(child => (
                          <div key={child.id} className="ml-6 flex items-start gap-2 p-2 bg-mc-bg-secondary rounded border border-mc-border">
                            <button
                              onClick={() => handleToggleCriteria(child.id, !child.is_met)}
                              className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                child.is_met
                                  ? 'bg-mc-accent-green text-white'
                                  : 'bg-mc-bg-tertiary border border-mc-border'
                              }`}
                            >
                              {child.is_met && <Check className="w-3 h-3" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <span className={`text-xs ${child.is_met ? 'line-through text-mc-text-secondary' : ''}`}>
                                {child.description}
                              </span>
                              <div className="text-[11px] text-mc-text-secondary mt-0.5">
                                {child.gate_type || 'manual'}{child.artifact_key ? ` • ${child.artifact_key}` : ''}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={newCriteriaDesc}
                      onChange={(e) => setNewCriteriaDesc(e.target.value)}
                      placeholder="Add acceptance criteria..."
                      className="sm:col-span-2 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCriteria();
                      }}
                    />
                    <select
                      value={newCriteriaStatus}
                      onChange={(e) => setNewCriteriaStatus(e.target.value as TaskStatus)}
                      className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      {Object.keys(STATUS_COLORS).map(status => (
                        <option key={`criteria-status-${status}`} value={status}>{status.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <select
                      value={newCriteriaGateType}
                      onChange={(e) => setNewCriteriaGateType(e.target.value as 'manual' | 'artifact' | 'test' | 'deploy' | 'verifier')}
                      className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      {['manual', 'artifact', 'test', 'deploy', 'verifier'].map(kind => (
                        <option key={`criteria-gate-${kind}`} value={kind}>{kind}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddCriteria}
                      disabled={!newCriteriaDesc.trim() || submittingCriteria}
                      className="sm:col-span-4 min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
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

              <CollapsibleSection title="Dependencies" badge={dependencies.length} defaultOpen={dependencies.length > 0 || Boolean(task?.is_blocked)}>
                <div className="space-y-3">
                  {task?.is_blocked && (
                    <div className="rounded border border-mc-accent-red/30 bg-mc-accent-red/10 px-3 py-2 text-xs text-mc-accent-red">
                      {task.blocked_reason || 'Task is blocked by unresolved dependencies.'}
                    </div>
                  )}

                  {dependencies.map((dependency) => {
                    const currentStatus = dependency.depends_on_task_status || dependency.depends_on_task?.status || 'unknown';
                    const resolved = currentStatus === dependency.required_status;
                    return (
                      <div
                        key={dependency.id}
                        className={`flex items-start gap-2 p-2 rounded border ${resolved ? 'bg-mc-bg border-mc-border' : 'bg-mc-accent-red/10 border-mc-accent-red/30'}`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${resolved ? 'bg-mc-accent-green text-white' : 'bg-mc-accent-red/20 text-mc-accent-red border border-mc-accent-red/30'}`}>
                          {resolved ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            Depends on task `{dependency.depends_on_task_id}`{dependency.depends_on_task_title ? ` (${dependency.depends_on_task_title})` : ''} to reach `{dependency.required_status}`
                          </p>
                          <p className="text-xs text-mc-text-secondary mt-1">
                            Current: {currentStatus.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteDependency(dependency.id)}
                          className="p-1.5 hover:bg-mc-accent-red/10 rounded text-mc-text-secondary hover:text-mc-accent-red"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={newDependencyTaskId}
                      onChange={(e) => setNewDependencyTaskId(e.target.value)}
                      placeholder="Depends on task id"
                      className="sm:col-span-2 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    />
                    <select
                      value={newDependencyStatus}
                      onChange={(e) => setNewDependencyStatus(e.target.value as TaskStatus)}
                      className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
                    >
                      {Object.keys(STATUS_COLORS).map((status) => (
                        <option key={`dep-status-${status}`} value={status}>{status.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddDependency}
                      disabled={!newDependencyTaskId.trim() || submittingDependency}
                      className="min-h-11 px-3 bg-mc-accent text-white rounded text-sm hover:bg-mc-accent/90 disabled:opacity-50"
                    >
                      {submittingDependency ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Add'}
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

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
