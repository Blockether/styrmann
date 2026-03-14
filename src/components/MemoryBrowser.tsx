'use client';
import { Brain, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Memory, MemoryType } from '@/lib/types';

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-blue-100 text-blue-800',
  decision: 'bg-purple-100 text-purple-800',
  event: 'bg-cyan-100 text-cyan-800',
  tool_run: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-800',
  observation: 'bg-yellow-100 text-yellow-800',
  note: 'bg-green-100 text-green-800',
  patch: 'bg-orange-100 text-orange-800',
};

const MEMORY_TYPES: MemoryType[] = ['fact', 'decision', 'event', 'tool_run', 'error', 'observation', 'note', 'patch'];

interface Props {
  organizationId?: string;
  workspaceId?: string;
}

export function MemoryBrowser({ organizationId, workspaceId }: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (organizationId) params.set('organization_id', organizationId);
    if (workspaceId) params.set('workspace_id', workspaceId);
    if (typeFilter !== 'all') params.set('memory_type', typeFilter);
    if (search) params.set('search', search);
    fetch(`/api/memories?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setMemories(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [organizationId, workspaceId, typeFilter, search]);

  return (
    <div data-component="src/components/MemoryBrowser" className="h-full flex flex-col">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-mc-accent" />
          <span className="font-mono text-sm font-semibold text-mc-text">Memories</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as MemoryType | 'all')}
            className="text-xs border border-mc-border rounded bg-mc-bg text-mc-text px-2 py-1 focus:outline-none focus:border-mc-accent">
            <option value="all">All types</option>
            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-mc-text-secondary" />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-6 pr-2 py-1 text-xs border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent w-36" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-sm text-mc-text-secondary">Loading...</div>}
        {!loading && memories.length === 0 && <div className="text-sm text-mc-text-secondary">No memories found.</div>}
        <div className="space-y-2">
          {memories.map(memory => (
            <div key={memory.id} className="p-3 rounded border border-mc-border bg-mc-bg-secondary">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-sm text-mc-text">{memory.title}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${TYPE_COLORS[memory.memory_type] || 'bg-gray-100 text-gray-700'}`}>{memory.memory_type}</span>
              </div>
              {memory.summary && <p className="mt-1 text-xs text-mc-text-secondary line-clamp-2">{memory.summary}</p>}
              <div className="mt-2 flex gap-3 text-xs text-mc-text-secondary">
                {memory.source && <span>Source: {memory.source}</span>}
                {memory.confidence != null && <span>Confidence: {memory.confidence}%</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
