'use client';
import { X, Ticket, Zap, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { OrgTicket } from '@/lib/types';

interface Props {
  ticket: OrgTicket;
  onClose: () => void;
  onUpdated?: (ticket: OrgTicket) => void;
}

export function OrgTicketModal({ ticket, onClose, onUpdated }: Props) {
  const [delegating, setDelegating] = useState(false);
  const [delegationResult, setDelegationResult] = useState<{ task_ids: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelegate = async () => {
    setDelegating(true);
    setError(null);
    try {
      const response = await fetch(`/api/org-tickets/${ticket.id}/delegate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Delegation failed');
      setDelegationResult(data);
      if (onUpdated) onUpdated({ ...ticket, status: 'delegated' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delegation failed');
    } finally {
      setDelegating(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    triaged: 'bg-yellow-100 text-yellow-800',
    delegated: 'bg-purple-100 text-purple-800',
    in_progress: 'bg-orange-100 text-orange-800',
    resolved: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-600',
  };

  const canDelegate = !['delegated', 'in_progress', 'resolved', 'closed'].includes(ticket.status);

  return (
    <div data-component="src/components/OrgTicketModal" className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-lg shadow-lg max-h-[85vh] flex flex-col">
        <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Ticket size={16} className="text-mc-accent" />
            <span className="font-mono text-sm font-semibold text-mc-text truncate">{ticket.title}</span>
          </div>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text"><X size={16} /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${STATUS_COLORS[ticket.status] || 'bg-gray-100 text-gray-600'}`}>{ticket.status}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-mc-bg font-mono text-mc-text-secondary border border-mc-border">{ticket.priority}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-mc-bg font-mono text-mc-text-secondary border border-mc-border">{ticket.ticket_type}</span>
            {ticket.external_ref && <span className="text-xs px-2 py-0.5 rounded bg-mc-bg font-mono text-mc-text-secondary border border-mc-border">{ticket.external_system}: {ticket.external_ref}</span>}
          </div>

          {ticket.description && (
            <div>
              <p className="text-xs font-mono text-mc-text-secondary mb-1">Description</p>
              <p className="text-sm text-mc-text">{ticket.description}</p>
            </div>
          )}

          {delegationResult && (
            <div className="p-3 rounded bg-green-50 border border-green-200">
              <p className="text-xs font-mono text-green-800 font-semibold">Delegated successfully</p>
              <p className="text-xs text-green-700 mt-1">{delegationResult.task_ids.length} workspace task(s) created</p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded bg-red-50 border border-red-200">
              <p className="text-xs font-mono text-red-800">{error}</p>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-mc-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded">Close</button>
          {canDelegate && !delegationResult && (
            <button
              onClick={handleDelegate}
              disabled={delegating}
              className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {delegating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              {delegating ? 'Delegating...' : 'Delegate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
