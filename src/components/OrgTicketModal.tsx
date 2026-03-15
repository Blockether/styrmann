'use client';
import { X, Ticket, Loader2, Check, Trash2, Plus, Zap, Folder } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { OrgTicket, OrgTicketAcceptanceCriteria, OrgTicketStatus, OrgTicketType, Task } from '@/lib/types';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface DelegatedTask {
  id: string;
  title: string;
  status: string;
  workspace_id: string;
  workspace_name?: string;
}

interface FullTicket extends OrgTicket {
  acceptance_criteria?: OrgTicketAcceptanceCriteria[];
  delegated_tasks?: DelegatedTask[];
}

interface Props {
  ticketId: string;
  organizationId: string;
  onClose: () => void;
  onUpdated?: () => void;
}

type TabType = 'overview' | 'criteria' | 'delegation';

const STATUS_TRANSITIONS: Record<OrgTicketStatus, OrgTicketStatus[]> = {
  open: ['triaged', 'closed'],
  triaged: ['delegated', 'closed'],
  delegated: ['in_progress', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  triaged: 'bg-yellow-100 text-yellow-800',
  delegated: 'bg-purple-100 text-purple-800',
  in_progress: 'bg-orange-100 text-orange-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-600',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  pending_dispatch: 'bg-gray-100 text-gray-600',
  planning: 'bg-blue-100 text-blue-800',
  inbox: 'bg-gray-100 text-gray-600',
  assigned: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-orange-100 text-orange-800',
  testing: 'bg-purple-100 text-purple-800',
  review: 'bg-indigo-100 text-indigo-800',
  verification: 'bg-teal-100 text-teal-800',
  done: 'bg-green-100 text-green-800',
};

export function OrgTicketModal({ ticketId, organizationId, onClose, onUpdated }: Props) {
  const [ticket, setTicket] = useState<FullTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const contentRef = useRef<HTMLDivElement>(null);

  // Form state for overview
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'open' as OrgTicketStatus,
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    ticket_type: 'task' as OrgTicketType,
    story_points: '' as number | '',
    due_date: '',
    assignee: '',
    external_ref: '',
  });

  // Acceptance criteria state
  const [criteria, setCriteria] = useState<OrgTicketAcceptanceCriteria[]>([]);
  const [newCriterionDesc, setNewCriterionDesc] = useState('');
  const [editingCriterionId, setEditingCriterionId] = useState<string | null>(null);
  const [editingCriterionDesc, setEditingCriterionDesc] = useState('');
  const [submittingCriteria, setSubmittingCriteria] = useState(false);

  // Delegation state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [delegationResult, setDelegationResult] = useState<{ task_ids: string[] } | null>(null);

  // Track original form values for dirty check
  const [originalForm, setOriginalForm] = useState<typeof form | null>(null);
  const isDirty = originalForm ? JSON.stringify(form) !== JSON.stringify(originalForm) : false;

  // Load ticket data
  useEffect(() => {
    const loadTicket = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/org-tickets/${ticketId}`);
        if (!res.ok) throw new Error('Failed to load ticket');
        const data: FullTicket = await res.json();
        setTicket(data);
        setCriteria(data.acceptance_criteria || []);
        
        const formData = {
          title: data.title || '',
          description: data.description || '',
          status: data.status,
          priority: data.priority,
          ticket_type: data.ticket_type,
          story_points: (typeof data.story_points === 'number' ? data.story_points : '') as number | '',
          due_date: data.due_date || '',
          assignee: data.assignee_name || '',
          external_ref: data.external_ref || '',
        };
        setForm(formData);
        setOriginalForm(formData);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load ticket');
      } finally {
        setLoading(false);
      }
    };
    loadTicket();
  }, [ticketId]);

  // Load workspaces for delegation
  useEffect(() => {
    const loadWorkspaces = async () => {
      try {
        const res = await fetch(`/api/organizations/${organizationId}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(data.workspaces || []);
        }
      } catch {
        // Ignore workspace load errors
      }
    };
    loadWorkspaces();
  }, [organizationId]);

  // Reset scroll when tab changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const handleSave = async () => {
    if (!ticket || !isDirty) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        ticket_type: form.ticket_type,
        story_points: form.story_points === '' ? null : form.story_points,
        due_date: form.due_date || null,
        assignee_name: form.assignee.trim() || null,
        external_ref: form.external_ref.trim() || null,
      };

      const res = await fetch(`/api/org-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save ticket');
      }

      const updated = await res.json();
      setTicket(updated);
      const formData = {
        title: updated.title || '',
        description: updated.description || '',
        status: updated.status,
        priority: updated.priority,
        ticket_type: updated.ticket_type,
        story_points: (typeof updated.story_points === 'number' ? updated.story_points : '') as number | '',
        due_date: updated.due_date || '',
        assignee: updated.assignee_name || '',
        external_ref: updated.external_ref || '',
      };
      setForm(formData);
      setOriginalForm(formData);
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save ticket');
    } finally {
      setSaving(false);
    }
  };

  // Acceptance criteria handlers
  const handleToggleCriteria = async (criteriaId: string, isMet: boolean) => {
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/acceptance-criteria/${criteriaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_met: isMet ? 1 : 0 }),
      });
      if (res.ok) {
        setCriteria(prev => prev.map(c => c.id === criteriaId ? { ...c, is_met: isMet ? 1 : 0 } : c));
      }
    } catch (e) {
      console.error('Failed to toggle criteria:', e);
    }
  };

  const handleAddCriteria = async () => {
    if (!newCriterionDesc.trim()) return;
    setSubmittingCriteria(true);
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/acceptance-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newCriterionDesc.trim(), sort_order: criteria.length }),
      });
      if (res.ok) {
        const newCriteria = await res.json();
        setCriteria(prev => [...prev, newCriteria]);
        setNewCriterionDesc('');
      }
    } catch (e) {
      console.error('Failed to add criteria:', e);
    } finally {
      setSubmittingCriteria(false);
    }
  };

  const handleEditCriteria = async (criteriaId: string) => {
    if (!editingCriterionDesc.trim()) return;
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/acceptance-criteria/${criteriaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editingCriterionDesc.trim() }),
      });
      if (res.ok) {
        setCriteria(prev => prev.map(c => c.id === criteriaId ? { ...c, description: editingCriterionDesc.trim() } : c));
        setEditingCriterionId(null);
        setEditingCriterionDesc('');
      }
    } catch (e) {
      console.error('Failed to edit criteria:', e);
    }
  };

  const handleDeleteCriteria = async (criteriaId: string) => {
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/acceptance-criteria/${criteriaId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setCriteria(prev => prev.filter(c => c.id !== criteriaId));
      }
    } catch (e) {
      console.error('Failed to delete criteria:', e);
    }
  };

  // Delegation handler
  const handleDelegate = async () => {
    if (!selectedWorkspaceId) return;
    setDelegating(true);
    setError(null);
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/delegate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: selectedWorkspaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delegation failed');
      setDelegationResult(data);
      // Reload ticket to get updated delegated_tasks
      const ticketRes = await fetch(`/api/org-tickets/${ticketId}`);
      if (ticketRes.ok) {
        const updated = await ticketRes.json();
        setTicket(updated);
        setForm(prev => ({ ...prev, status: updated.status }));
      }
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delegation failed');
    } finally {
      setDelegating(false);
    }
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'criteria', label: 'Acceptance Criteria' },
    { id: 'delegation', label: 'Delegation' },
  ];

  if (loading) {
    return (
      <div data-component="src/components/OrgTicketModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
        <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-2xl shadow-lg p-6 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-mc-text-secondary" />
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div data-component="src/components/OrgTicketModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
        <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-2xl shadow-lg p-6">
          <p className="text-sm text-mc-text-secondary">{error || 'Ticket not found'}</p>
          <button onClick={onClose} className="mt-4 px-3 py-1.5 text-xs font-mono border border-mc-border rounded hover:bg-mc-bg">Close</button>
        </div>
      </div>
    );
  }

  const canDelegate = !['closed'].includes(ticket.status);

  return (
    <div data-component="src/components/OrgTicketModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-2xl shadow-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Ticket size={16} className="text-mc-accent shrink-0" />
            <span className="font-mono text-sm font-semibold text-mc-text truncate">{ticket.title}</span>
          </div>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-mc-border bg-mc-bg-secondary flex-shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-mc-accent text-mc-text'
                  : 'border-transparent text-mc-text-secondary hover:text-mc-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 rounded bg-red-50 border border-red-200">
              <p className="text-xs font-mono text-red-800">{error}</p>
            </div>
          )}

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-mc-text-secondary mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm({ ...form, status: e.target.value as OrgTicketStatus })}
                    className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value={ticket.status}>{ticket.status}</option>
                    {STATUS_TRANSITIONS[ticket.status]?.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <p className="text-xs text-mc-text-secondary mt-1">Valid transitions from {ticket.status}</p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-mc-text-secondary mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm({ ...form, priority: e.target.value as typeof form.priority })}
                    className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-mc-text-secondary mb-1">Ticket Type</label>
                  <select
                    value={form.ticket_type}
                    onChange={e => setForm({ ...form, ticket_type: e.target.value as OrgTicketType })}
                    className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value="task">Task</option>
                    <option value="feature">Feature</option>
                    <option value="bug">Bug</option>
                    <option value="improvement">Improvement</option>
                    <option value="epic">Epic</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-mc-text-secondary mb-1">Story Points</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.story_points}
                    onChange={e => setForm({ ...form, story_points: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}
                    className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="0-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Due Date</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm({ ...form, due_date: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Assignee</label>
                <input
                  type="text"
                  value={form.assignee}
                  onChange={e => setForm({ ...form, assignee: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  placeholder="Assignee name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-mc-text-secondary mb-1">External Reference</label>
                  <input
                    type="text"
                    value={form.external_ref}
                    onChange={e => setForm({ ...form, external_ref: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="JIRA-123"
                  />
                </div>


              </div>
            </div>
          )}

          {/* Acceptance Criteria Tab */}
          {activeTab === 'criteria' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-mono font-semibold text-mc-text">Acceptance Criteria</h3>
                {criteria.length > 0 && (
                  <span className="text-xs text-mc-text-secondary">
                    {criteria.filter(c => c.is_met).length}/{criteria.length} met
                  </span>
                )}
              </div>

              {criteria.length > 0 ? (
                <div className="space-y-2">
                  {criteria.map(c => (
                    <div key={c.id} className="flex items-start gap-2 p-2 bg-mc-bg border border-mc-border rounded">
                      <button
                        onClick={() => handleToggleCriteria(c.id, !c.is_met)}
                        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          c.is_met
                            ? 'bg-green-500 text-white'
                            : 'bg-mc-bg-tertiary border border-mc-border hover:border-mc-accent'
                        }`}
                      >
                        {c.is_met && <Check size={12} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        {editingCriterionId === c.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editingCriterionDesc}
                              onChange={e => setEditingCriterionDesc(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleEditCriteria(c.id); } }}
                              className="flex-1 px-2 py-1 text-xs font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                              autoFocus
                            />
                            <button
                              onClick={() => handleEditCriteria(c.id)}
                              className="px-2 py-1 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingCriterionId(null); setEditingCriterionDesc(''); }}
                              className="px-2 py-1 text-xs font-mono border border-mc-border rounded hover:bg-mc-bg"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span className={`text-sm ${c.is_met ? 'line-through text-mc-text-secondary' : 'text-mc-text'}`}>
                            {c.description}
                          </span>
                        )}
                      </div>
                      {editingCriterionId !== c.id && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setEditingCriterionId(c.id); setEditingCriterionDesc(c.description); }}
                            className="p-1 text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary rounded"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                          </button>
                          <button
                            onClick={() => handleDeleteCriteria(c.id)}
                            className="p-1 text-mc-text-secondary hover:text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-mc-text-secondary">No acceptance criteria defined yet.</p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCriterionDesc}
                  onChange={e => setNewCriterionDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCriteria(); } }}
                  placeholder="Add acceptance criterion..."
                  className="flex-1 px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                />
                <button
                  onClick={handleAddCriteria}
                  disabled={!newCriterionDesc.trim() || submittingCriteria}
                  className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {submittingCriteria ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  <span className="hidden sm:inline">Add</span>
                </button>
              </div>
            </div>
          )}

          {/* Delegation Tab */}
          {activeTab === 'delegation' && (
            <div className="space-y-4">
              <h3 className="text-sm font-mono font-semibold text-mc-text">Delegation</h3>

              {delegationResult && (
                <div className="p-3 rounded bg-green-50 border border-green-200">
                  <p className="text-xs font-mono text-green-800 font-semibold">Delegated successfully</p>
                  <p className="text-xs text-green-700 mt-1">{delegationResult.task_ids.length} workspace task(s) created</p>
                </div>
              )}

              {/* Existing delegated tasks */}
              {ticket.delegated_tasks && ticket.delegated_tasks.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-mc-text-secondary mb-2">Delegated Tasks</p>
                  <div className="space-y-2">
                    {ticket.delegated_tasks.map(task => (
                      <div key={task.id} className="p-2 bg-mc-bg border border-mc-border rounded">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-mc-text truncate">{task.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${TASK_STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-600'}`}>
                            {task.status}
                          </span>
                        </div>
                        {task.workspace_name && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-mc-text-secondary">
                            <Folder size={10} />
                            <span>{task.workspace_name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delegate form */}
              {canDelegate && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-mono text-mc-text-secondary mb-1">Target Workspace</label>
                    <select
                      value={selectedWorkspaceId}
                      onChange={e => setSelectedWorkspaceId(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    >
                      <option value="">Select workspace...</option>
                      {workspaces.map(ws => (
                        <option key={ws.id} value={ws.id}>{ws.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-mc-text-secondary mt-1">Creates a workspace task linked to this org ticket</p>
                  </div>

                  <button
                    onClick={handleDelegate}
                    disabled={!selectedWorkspaceId || delegating}
                    className="w-full px-3 py-2 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {delegating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    {delegating ? 'Delegating...' : 'Delegate to Workspace'}
                  </button>
                </div>
              )}

              {!canDelegate && (
                <p className="text-xs text-mc-text-secondary">This ticket cannot be delegated in its current status.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-mc-border flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded"
          >
            Close
          </button>
          {activeTab === 'overview' && (
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
