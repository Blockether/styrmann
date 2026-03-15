'use client';
import { X, Ticket, Plus, Loader2, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
import type { OrgTicket } from '@/lib/types';

interface Props {
  organizationId: string;
  initialSprintId?: string | null;
  initialMilestoneId?: string | null;
  onClose: () => void;
  onCreated: (ticket: OrgTicket) => void;
}

interface AcceptanceCriterion {
  id: string;
  description: string;
}

export function OrgTicketCreateModal({
  organizationId,
  initialSprintId,
  initialMilestoneId,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [ticketType, setTicketType] = useState<'feature' | 'bug' | 'improvement' | 'task' | 'epic'>('task');
  const [storyPoints, setStoryPoints] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCriterion = () => {
    if (!newCriterion.trim()) return;
    setCriteria([...criteria, { id: crypto.randomUUID(), description: newCriterion.trim() }]);
    setNewCriterion('');
  };

  const removeCriterion = (id: string) => {
    setCriteria(criteria.filter(c => c.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Create the ticket
      const response = await fetch('/api/org-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          ticket_type: ticketType,
          story_points: storyPoints === '' ? undefined : storyPoints,
          due_date: dueDate || undefined,
          assignee_name: assignee.trim() || undefined,
          external_ref: externalRef.trim() || undefined,
          org_sprint_id: initialSprintId || undefined,
          org_milestone_id: initialMilestoneId || undefined,
          tags: [],
        }),
      });

      const ticket = await response.json();
      if (!response.ok) {
        throw new Error(ticket.error || 'Failed to create ticket');
      }

      // Create acceptance criteria
      for (let i = 0; i < criteria.length; i++) {
        const criterion = criteria[i];
        await fetch(`/api/org-tickets/${ticket.id}/acceptance-criteria`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: criterion.description,
            sort_order: i,
          }),
        });
      }

      // Upload attached files
      for (const file of attachedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`/api/org-tickets/${ticket.id}/attachments`, {
          method: 'POST',
          body: formData,
        });
      }

      onCreated({
        ...(ticket as OrgTicket),
        org_sprint_id: (ticket as OrgTicket).org_sprint_id ?? initialSprintId ?? null,
        org_milestone_id: (ticket as OrgTicket).org_milestone_id ?? initialMilestoneId ?? null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-component="src/components/OrgTicketCreateModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-lg shadow-lg max-h-[85vh] flex flex-col">
        <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Ticket size={16} className="text-mc-accent" />
            <span className="font-mono text-sm font-semibold text-mc-text">Create Ticket</span>
          </div>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 overflow-y-auto flex-1 space-y-4">
            {error && (
              <div className="p-3 rounded bg-red-50 border border-red-200">
                <p className="text-xs font-mono text-red-800">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                placeholder="Ticket title"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent resize-none"
                placeholder="Describe the ticket..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value as typeof priority)}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Type</label>
                <select
                  value={ticketType}
                  onChange={e => setTicketType(e.target.value as typeof ticketType)}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                >
                  <option value="task">Task</option>
                  <option value="feature">Feature</option>
                  <option value="bug">Bug</option>
                  <option value="improvement">Improvement</option>
                  <option value="epic">Epic</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Story Points</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={storyPoints}
                  onChange={e => setStoryPoints(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                  placeholder="0-100"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-mc-text-secondary mb-1">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">Assignee</label>
              <input
                type="text"
                value={assignee}
                onChange={e => setAssignee(e.target.value)}
                className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                placeholder="Assignee name"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">External Reference</label>
              <input
                type="text"
                value={externalRef}
                onChange={e => setExternalRef(e.target.value)}
                className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                placeholder="JIRA-123"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">Acceptance Criteria</label>
              <div className="space-y-2">
                {criteria.length > 0 && (
                  <div className="space-y-1">
                    {criteria.map(c => (
                      <div key={c.id} className="flex items-center gap-2 p-2 bg-mc-bg border border-mc-border rounded">
                        <span className="flex-1 text-xs text-mc-text truncate">{c.description}</span>
                        <button
                          type="button"
                          onClick={() => removeCriterion(c.id)}
                          className="text-mc-text-secondary hover:text-red-500"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCriterion}
                    onChange={e => setNewCriterion(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCriterion(); } }}
                    className="flex-1 px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    placeholder="Add acceptance criterion..."
                  />
                  <button
                    type="button"
                    onClick={addCriterion}
                    disabled={!newCriterion.trim()}
                    className="px-2 py-1.5 text-xs font-mono bg-mc-bg border border-mc-border rounded hover:border-mc-accent text-mc-text-secondary hover:text-mc-text disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Plus size={12} />
                    <span className="hidden sm:inline">Add</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div>
              <label className="block text-xs font-mono text-mc-text-secondary mb-1">Attachments</label>
              <div
                className="border-2 border-dashed border-mc-border rounded p-4 text-center cursor-pointer hover:border-mc-accent transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length > 0) setAttachedFiles(prev => [...prev, ...files]);
                }}
                onClick={() => fileInputRef.current?.click()}
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
                <div className="mt-2 space-y-1">
                  {attachedFiles.map((file, i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1 bg-mc-bg rounded text-sm">
                      <span className="truncate text-mc-text">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAttachedFiles(prev => prev.filter((_, j) => j !== i)); }}
                        className="text-mc-text-secondary hover:text-red-500"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-3 border-t border-mc-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {submitting ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
