'use client';
import Link from 'next/link';
import { X, Ticket, Loader2, Check, Trash2, Plus, Zap, Folder, Upload, Download, Paperclip } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { OrgTicket, OrgTicketAcceptanceCriteria, OrgTicketAttachment, OrgTicketStatus, OrgTicketType, Task } from '@/lib/types';

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
  attachments?: OrgTicketAttachment[];
}

interface Props {
  ticketId: string;
  organizationId: string;
  onClose: () => void;
  onUpdated?: () => void;
}

const STATUS_TRANSITIONS: Record<OrgTicketStatus, OrgTicketStatus[]> = {
  open: ['triaged', 'closed'],
  triaged: ['delegated', 'closed'],
  delegated: ['in_progress', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-mc-accent/15 text-mc-accent',
  triaged: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  delegated: 'bg-mc-accent-purple/15 text-mc-accent-purple',
  in_progress: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  resolved: 'bg-mc-accent-green/15 text-mc-accent-green',
  closed: 'bg-mc-bg-tertiary text-mc-text-secondary',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  pending_dispatch: 'bg-mc-bg-tertiary text-mc-text-secondary',
  planning: 'bg-mc-accent/15 text-mc-accent',
  inbox: 'bg-mc-bg-tertiary text-mc-text-secondary',
  assigned: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  in_progress: 'bg-mc-accent-yellow/15 text-mc-accent-yellow',
  testing: 'bg-mc-accent-purple/15 text-mc-accent-purple',
  review: 'bg-mc-accent-cyan/15 text-mc-accent-cyan',
  verification: 'bg-mc-accent-cyan/15 text-mc-accent-cyan',
  done: 'bg-mc-accent-green/15 text-mc-accent-green',
};

export function OrgTicketModal({ ticketId, organizationId, onClose, onUpdated }: Props) {
  const [ticket, setTicket] = useState<FullTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const [criteria, setCriteria] = useState<OrgTicketAcceptanceCriteria[]>([]);
  const [newCriterionDesc, setNewCriterionDesc] = useState('');
  const [editingCriterionId, setEditingCriterionId] = useState<string | null>(null);
  const [editingCriterionDesc, setEditingCriterionDesc] = useState('');
  const [submittingCriteria, setSubmittingCriteria] = useState(false);

  const [attachments, setAttachments] = useState<OrgTicketAttachment[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [delegationResult, setDelegationResult] = useState<{ task_ids: string[] } | null>(null);

  const [originalForm, setOriginalForm] = useState<typeof form | null>(null);
  const isDirty = originalForm ? JSON.stringify(form) !== JSON.stringify(originalForm) : false;

  useEffect(() => {
    const loadTicket = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/org-tickets/${ticketId}`);
        if (!res.ok) throw new Error('Failed to load ticket');
        const data: FullTicket = await res.json();
        setTicket(data);
        setCriteria(data.acceptance_criteria || []);
        setAttachments(data.attachments || []);
        
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

  const handleUploadFiles = async () => {
    if (attachedFiles.length === 0) return;
    setUploadingFiles(true);
    try {
      for (const file of attachedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/org-tickets/${ticketId}/attachments`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const newAttachment = await res.json();
          setAttachments(prev => [newAttachment, ...prev]);
        }
      }
      setAttachedFiles([]);
    } catch (e) {
      console.error('Failed to upload files:', e);
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      const res = await fetch(`/api/org-tickets/${ticketId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setAttachments(prev => prev.filter(a => a.id !== attachmentId));
      }
    } catch (e) {
      console.error('Failed to delete attachment:', e);
    }
  };

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
          <button onClick={onClose} className="mt-4 px-3 py-1.5 text-sm border border-mc-border rounded hover:bg-mc-bg">Close</button>
        </div>
      </div>
    );
  }

  const hasDelegatedTasks = (ticket.delegated_tasks?.length || 0) > 0;
  const isReadOnly = hasDelegatedTasks || ticket.status === 'delegated';
  const canDelegate = !isReadOnly && !['closed'].includes(ticket.status);

  return (
    <div data-component="src/components/OrgTicketModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-2xl shadow-lg max-h-[85vh] flex flex-col">
        <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Ticket size={16} className="text-mc-accent shrink-0" />
            <span className="text-lg font-semibold text-mc-text truncate">{ticket.title}</span>
          </div>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text shrink-0">
            <X size={16} />
          </button>
        </div>

        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 rounded bg-mc-accent-red/10 border border-mc-accent-red/30">
              <p className="text-sm text-mc-accent-red">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-3">Overview</h3>
            {isReadOnly ? (
              <div className="rounded border border-mc-border bg-mc-bg p-3 space-y-3">
                <p className="text-sm text-mc-text-secondary">This ticket is already delegated to workspace task(s), so it is shown in read-only mode here. Continue execution from the linked workspace task.</p>
                <div>
                  <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Title</div>
                  <div className="text-sm text-mc-text">{ticket.title}</div>
                </div>
                {ticket.description && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Description</div>
                    <div className="text-sm text-mc-text whitespace-pre-wrap break-words">{ticket.description}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Status</div>
                    <div className={`inline-flex px-2 py-0.5 rounded-full text-xs font-mono ${STATUS_COLORS[ticket.status] || 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>{ticket.status}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Priority</div>
                    <div className="text-sm text-mc-text">{ticket.priority}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Ticket Type</div>
                    <div className="text-sm text-mc-text">{ticket.ticket_type}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Story Points</div>
                    <div className="text-sm text-mc-text">{typeof ticket.story_points === 'number' ? ticket.story_points : '-'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">Assignee</div>
                    <div className="text-sm text-mc-text">{ticket.assignee_name || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium mb-1">External Reference</div>
                    <div className="text-sm text-mc-text break-words">{ticket.external_ref || '-'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-mc-text-secondary mb-1">Title</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  />
                </div>

                <div>
                  <label className="block text-sm text-mc-text-secondary mb-1">Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-mc-text-secondary mb-1">Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm({ ...form, status: e.target.value as OrgTicketStatus })}
                      className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    >
                      <option value={ticket.status}>{ticket.status}</option>
                      {STATUS_TRANSITIONS[ticket.status]?.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <p className="text-sm text-mc-text-secondary mt-1">Valid transitions from {ticket.status}</p>
                  </div>

                  <div>
                    <label className="block text-sm text-mc-text-secondary mb-1">Priority</label>
                    <select
                      value={form.priority}
                      onChange={e => setForm({ ...form, priority: e.target.value as typeof form.priority })}
                      className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
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
                    <label className="block text-sm text-mc-text-secondary mb-1">Ticket Type</label>
                    <select
                      value={form.ticket_type}
                      onChange={e => setForm({ ...form, ticket_type: e.target.value as OrgTicketType })}
                      className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    >
                      <option value="task">Task</option>
                      <option value="feature">Feature</option>
                      <option value="bug">Bug</option>
                      <option value="improvement">Improvement</option>
                      <option value="epic">Epic</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-mc-text-secondary mb-1">Story Points</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.story_points}
                      onChange={e => setForm({ ...form, story_points: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}
                      className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      placeholder="0-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-mc-text-secondary mb-1">Assignee</label>
                  <input
                    type="text"
                    value={form.assignee}
                    onChange={e => setForm({ ...form, assignee: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="Assignee name"
                  />
                </div>

                <div>
                  <label className="block text-sm text-mc-text-secondary mb-1">External Reference</label>
                  <input
                    type="text"
                    value={form.external_ref}
                    onChange={e => setForm({ ...form, external_ref: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="JIRA-123"
                  />
                </div>
              </>
            )}
          </div>

          <div className="border-t border-mc-border my-6" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Acceptance Criteria</h3>
              {criteria.length > 0 && (
                <span className="text-sm text-mc-text-secondary">
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
                      disabled={isReadOnly}
                      className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        c.is_met
                          ? 'bg-green-500 text-white'
                          : 'bg-mc-bg-tertiary border border-mc-border hover:border-mc-accent'
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
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
                            className="flex-1 px-2 py-1 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                            autoFocus
                          />
                          <button
                            onClick={() => handleEditCriteria(c.id)}
                            className="px-2 py-1 text-sm bg-mc-accent text-white rounded hover:opacity-90"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingCriterionId(null); setEditingCriterionDesc(''); }}
                            className="px-2 py-1 text-sm border border-mc-border rounded hover:bg-mc-bg"
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
                          disabled={isReadOnly}
                          onClick={() => { setEditingCriterionId(c.id); setEditingCriterionDesc(c.description); }}
                          className="p-1 text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary rounded disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        </button>
                        <button
                          disabled={isReadOnly}
                          onClick={() => handleDeleteCriteria(c.id)}
                          className="p-1 text-mc-text-secondary hover:text-red-500 hover:bg-red-50 rounded disabled:opacity-60 disabled:cursor-not-allowed"
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
                disabled={isReadOnly}
                className="flex-1 px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleAddCriteria}
                disabled={isReadOnly || !newCriterionDesc.trim() || submittingCriteria}
                className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {submittingCriteria ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                <span className="hidden sm:inline">Add</span>
              </button>
            </div>
          </div>

          <div className="border-t border-mc-border my-6" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Attachments</h3>
              {attachments.length > 0 && (
                <span className="text-sm text-mc-text-secondary">{attachments.length} file(s)</span>
              )}
            </div>

            <div
              className={`border-2 border-dashed border-mc-border rounded p-4 text-center transition-colors ${isReadOnly ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-mc-accent'}`}
              onDragOver={(e) => { if (isReadOnly) return; e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                if (isReadOnly) return;
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length > 0) setAttachedFiles(prev => [...prev, ...files]);
              }}
              onClick={() => { if (!isReadOnly) fileInputRef.current?.click(); }}
            >
              <Upload size={20} className="mx-auto mb-1 text-mc-text-secondary" />
              <div className="text-sm text-mc-text-secondary">Drop files here or click to upload</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) setAttachedFiles(prev => [...prev, ...files]);
                if (e.target) e.target.value = '';
              }}
            />

            {attachedFiles.length > 0 && (
              <div className="space-y-1">
                {attachedFiles.map((file, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 bg-mc-bg rounded text-sm">
                    <span className="truncate text-mc-text">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        disabled={isReadOnly}
                        onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                        className="text-mc-text-secondary hover:text-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={handleUploadFiles}
                  disabled={isReadOnly || uploadingFiles}
                  className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {uploadingFiles ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {uploadingFiles ? 'Uploading...' : 'Upload Files'}
                </button>
              </div>
            )}

            {attachments.length > 0 ? (
              <div className="space-y-2">
                {attachments.map(att => (
                  <div key={att.id} className="flex items-center justify-between gap-2 p-2 bg-mc-bg border border-mc-border rounded">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip size={14} className="text-mc-text-secondary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-mc-text truncate">{att.file_name}</div>
                        <div className="text-sm text-mc-text-secondary">
                          {att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : 'Unknown size'}
                          {att.mime_type ? ` - ${att.mime_type}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={`/api/org-tickets/${ticketId}/attachments/${att.id}`}
                        download={att.file_name}
                        className="p-1 text-mc-text-secondary hover:text-mc-accent hover:bg-mc-bg-tertiary rounded"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                      <button
                        disabled={isReadOnly}
                        onClick={() => handleDeleteAttachment(att.id)}
                        className="p-1 text-mc-text-secondary hover:text-red-500 hover:bg-red-50 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-mc-text-secondary">No attachments yet.</p>
            )}
          </div>

          <div className="border-t border-mc-border my-6" />

          <div className="space-y-4">
            <h3 className="text-xs uppercase tracking-wide text-mc-text-secondary font-medium">Delegation</h3>

            {delegationResult && (
              <div className="p-3 rounded bg-green-50 border border-green-200">
                <p className="text-sm text-green-800 font-semibold">Delegated successfully</p>
                <p className="text-sm text-green-700 mt-1">{delegationResult.task_ids.length} workspace task(s) created</p>
              </div>
            )}

            {ticket.delegated_tasks && ticket.delegated_tasks.length > 0 && (
              <div>
                <p className="text-sm text-mc-text-secondary mb-2">Delegated Tasks</p>
                <div className="space-y-2">
                   {ticket.delegated_tasks.map(task => {
                     const workspace = workspaces.find((ws) => ws.id === task.workspace_id);
                     const taskHref = workspace ? `/workspace/${workspace.slug}?task=${task.id}` : null;
                     const deliverablesHref = workspace ? `/workspace/${workspace.slug}?task=${task.id}&tab=deliverables` : null;
                     return (
                     <div key={task.id} className="p-2 bg-mc-bg border border-mc-border rounded space-y-2">
                       <div className="flex items-center justify-between gap-2">
                         <span className="text-sm text-mc-text truncate">{task.title}</span>
                         <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${TASK_STATUS_COLORS[task.status] || 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>
                           {task.status}
                         </span>
                       </div>
                       {task.workspace_name && (
                         <div className="mt-1 flex items-center gap-1 text-sm text-mc-text-secondary">
                           <Folder size={10} />
                           <span>{task.workspace_name}</span>
                         </div>
                       )}
                       <div className="flex items-center gap-2 flex-wrap">
                         {taskHref && (
                           <Link href={taskHref} className="px-2 py-1 text-xs border border-mc-border rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text">
                             Open Task
                           </Link>
                         )}
                         {deliverablesHref && (
                           <Link href={deliverablesHref} className="px-2 py-1 text-xs border border-mc-border rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text">
                             Deliverables
                           </Link>
                         )}
                       </div>
                     </div>
                   );})}
                 </div>
               </div>
             )}

            {canDelegate && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-mc-text-secondary mb-1">Target Workspace</label>
                  <select
                    value={selectedWorkspaceId}
                    onChange={e => setSelectedWorkspaceId(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  >
                    <option value="">Select workspace...</option>
                    {workspaces.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                  <p className="text-sm text-mc-text-secondary mt-1">Creates a workspace task linked to this org ticket.</p>
                </div>

                <button
                  onClick={handleDelegate}
                  disabled={!selectedWorkspaceId || delegating}
                  className="w-full px-3 py-2 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {delegating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {delegating ? 'Delegating...' : 'Delegate to Workspace'}
                </button>
              </div>
            )}

            {!canDelegate && (
              <p className="text-sm text-mc-text-secondary">This ticket is already delegated or otherwise locked. Continue work from the linked workspace task.</p>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-mc-border flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-mc-text-secondary hover:text-mc-text border border-mc-border rounded"
          >
            Close
          </button>
          {!isReadOnly && (
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="px-3 py-1.5 text-sm bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
