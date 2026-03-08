'use client';

import { useState } from 'react';
import { X, Loader2, Target } from 'lucide-react';
import type { Agent, TaskPriority } from '@/lib/types';

interface CreateMilestoneModalProps {
  workspaceId: string;
  sprintId?: string;
  agents: Agent[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateMilestoneModal({ workspaceId, sprintId, agents, onClose, onCreated }: CreateMilestoneModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    priority: 'normal' as TaskPriority,
    coordinator_agent_id: '',
  });

  const handleSubmit = async () => {
    if (!form.name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          sprint_id: sprintId || null,
          name: form.name.trim(),
          description: form.description.trim() || null,
          priority: form.priority,
          coordinator_agent_id: form.coordinator_agent_id || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to create milestone' }));
        setError(data.error || 'Failed to create milestone');
        return;
      }

      onCreated();
      onClose();
    } catch {
      setError('Failed to create milestone');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-component="src/components/CreateMilestoneModal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-lg flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-mc-accent" />
            <h2 className="text-lg font-semibold">New Milestone</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1">Name <span className="text-mc-accent-red">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Authentication System"
              className="w-full min-h-11 px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does this milestone cover?"
              rows={3}
              className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Priority</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
              className="w-full min-h-11 px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {agents.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Coordinator Agent</label>
              <select
                value={form.coordinator_agent_id}
                onChange={(e) => setForm({ ...form, coordinator_agent_id: e.target.value })}
                className="w-full min-h-11 px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">No coordinator</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
              <p className="text-xs text-mc-text-secondary mt-1">Agent responsible for coordinating this milestone</p>
            </div>
          )}

          {error && (
            <p className="text-sm text-mc-accent-red">{error}</p>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-mc-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 min-h-9 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !form.name.trim()}
            className="flex items-center gap-2 px-4 min-h-9 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Milestone
          </button>
        </div>
      </div>
    </div>
  );
}
