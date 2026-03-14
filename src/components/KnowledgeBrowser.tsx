'use client';
import { BookOpen, Search, RefreshCw } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import type { KnowledgeArticle } from '@/lib/types';

interface Props {
  organizationId: string;
  workspaceId?: string;
}

export function KnowledgeBrowser({ organizationId, workspaceId }: Props) {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ organization_id: organizationId });
    if (workspaceId) params.set('workspace_id', workspaceId);
    if (search) params.set('search', search);
    fetch(`/api/knowledge?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setArticles(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [organizationId, workspaceId, search]);

  useEffect(() => { load(); }, [load]);

  const handleSynthesize = async () => {
    setSynthesizing(true);
    await fetch('/api/knowledge/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: organizationId, workspace_id: workspaceId, force_refresh: true }),
    });
    setSynthesizing(false);
    load();
  };

  return (
    <div data-component="src/components/KnowledgeBrowser" className="h-full flex flex-col">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-mc-accent" />
          <span className="font-mono text-sm font-semibold text-mc-text">Knowledge</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-mc-text-secondary" />
            <input
              type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-6 pr-2 py-1 text-xs border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent w-40"
            />
          </div>
          <button onClick={handleSynthesize} disabled={synthesizing}
            className="px-2 py-1 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded flex items-center gap-1">
            <RefreshCw size={12} className={synthesizing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Synthesize</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-sm text-mc-text-secondary">Loading...</div>}
        {!loading && articles.length === 0 && <div className="text-sm text-mc-text-secondary">No knowledge articles. Add memories and click Synthesize.</div>}
        <div className="space-y-2">
          {articles.map(article => (
            <div key={article.id} onClick={() => setSelected(article)}
              className="p-3 rounded border border-mc-border bg-mc-bg-secondary hover:border-mc-accent cursor-pointer transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-mc-text">{article.title}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${article.status === 'stale' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>{article.status}</span>
              </div>
              <p className="mt-1 text-xs text-mc-text-secondary line-clamp-2">{article.summary}</p>
            </div>
          ))}
        </div>
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-mc-bg-secondary border border-mc-border rounded w-full max-w-2xl shadow-lg max-h-[80vh] flex flex-col">
              <div className="p-3 border-b border-mc-border flex items-center justify-between">
                <span className="font-mono text-sm font-semibold">{selected.title}</span>
                <button onClick={() => setSelected(null)} className="text-mc-text-secondary hover:text-mc-text text-xs">Close</button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <p className="text-xs text-mc-text-secondary mb-3">{selected.summary}</p>
                <p className="text-sm text-mc-text whitespace-pre-wrap">{selected.body}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
