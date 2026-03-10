'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2, Play, Save, Search } from 'lucide-react';

type PipelineConfig = {
  enabled: number;
  llm_enabled: number;
  schedule_cron: string;
  top_k: number;
  llm_model: string;
  llm_base_url: string;
  summary_prompt: string;
};

type AgentStatus = {
  id: string;
  name: string;
  role: string;
  workspace_id: string;
  memory_items: number;
  soul_items: number;
  agents_items: number;
  user_items: number;
  workspace_path?: string;
};

export function MemoryPipelinePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ title: string; content: string; score: number; source: string }>>([]);
  const [message, setMessage] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/memory/pipeline');
      if (!res.ok) throw new Error('Failed to load memory pipeline config');
      const data = await res.json();
      setConfig(data.config);
      setAgents(data.agents || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load memory pipeline panel');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/memory/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save memory pipeline config');
      const data = await res.json();
      setConfig(data.config);
      setMessage('Pipeline config saved. Restart daemon to apply schedule changes immediately.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const runPipeline = async () => {
    setRunning(true);
    setMessage('');
    try {
      const res = await fetch('/api/memory/pipeline/run', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to run pipeline');
      const data = await res.json();
      setMessage(`Pipeline run complete: agents=${data.consolidation.syncedAgents}, vectors=${data.vectors.indexed}`);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pipeline run failed');
    } finally {
      setRunning(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/memory/search?q=${encodeURIComponent(searchQuery)}&limit=8`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      setSearchResults(results.map((item: unknown) => {
        const record = item as { title?: string; content?: string; score?: number; source?: string };
        return {
          title: record.title || 'Untitled memory',
          content: record.content || '',
          score: typeof record.score === 'number' ? record.score : 0,
          source: record.source || 'unknown',
        };
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  if (loading || !config) {
    return (
      <div data-component="src/components/MemoryPipelinePanel" className="p-6 flex items-center justify-center text-mc-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading memory pipeline...
      </div>
    );
  }

  return (
    <div data-component="src/components/MemoryPipelinePanel" className="space-y-4 p-4 sm:p-6">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap rounded-lg">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-mc-text-secondary" />
          <h2 className="text-sm font-medium text-mc-text">Memory Pipeline</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runPipeline}
            disabled={running}
            className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span className="hidden sm:inline">Run Now</span>
          </button>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </div>

      {message && <div className="text-xs text-mc-text-secondary">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-mc-border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium">Pipeline Settings</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(config.enabled)}
              onChange={(event) => setConfig({ ...config, enabled: event.target.checked ? 1 : 0 })}
            />
            Enable consolidation
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(config.llm_enabled)}
              onChange={(event) => setConfig({ ...config, llm_enabled: event.target.checked ? 1 : 0 })}
            />
            Enable LLM summarization
          </label>
          <div>
            <label className="block text-xs text-mc-text-secondary mb-1">Schedule</label>
            <select
              value={config.schedule_cron}
              onChange={(event) => setConfig({ ...config, schedule_cron: event.target.value })}
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            >
              <option value="0 * * * *">Every 60 minutes</option>
              <option value="*/15 * * * *">Every 15 minutes</option>
              <option value="*/5 * * * *">Every 5 minutes</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-mc-text-secondary mb-1">Top K Learnings / agent</label>
            <input
              type="number"
              min={1}
              max={100}
              value={config.top_k}
              onChange={(event) => setConfig({ ...config, top_k: Number(event.target.value) || 24 })}
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-mc-text-secondary mb-1">LLM Model</label>
            <input
              type="text"
              value={config.llm_model}
              onChange={(event) => setConfig({ ...config, llm_model: event.target.value })}
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-mc-text-secondary mb-1">LLM Base URL</label>
            <input
              type="text"
              value={config.llm_base_url}
              onChange={(event) => setConfig({ ...config, llm_base_url: event.target.value })}
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-mc-text-secondary mb-1">Summary Prompt</label>
            <textarea
              value={config.summary_prompt}
              onChange={(event) => setConfig({ ...config, summary_prompt: event.target.value })}
              className="w-full min-h-24 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="border border-mc-border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium">Semantic Search</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search memories..."
              className="flex-1 min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={runSearch}
              disabled={searching}
              className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>
          <div className="space-y-2 max-h-80 overflow-auto pr-1">
            {searchResults.length === 0 ? (
              <div className="text-xs text-mc-text-secondary">No results yet.</div>
            ) : (
              searchResults.map((result, index) => (
                <div key={`${result.title}-${index}`} className="border border-mc-border rounded p-2 text-xs">
                  <div className="font-medium text-mc-text">{result.title}</div>
                  <div className="text-mc-text-secondary mt-1">{result.content}</div>
                  <div className="text-mc-text-secondary mt-1">score: {result.score.toFixed(3)} | source: {result.source}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border border-mc-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Per-Agent Consolidation Status</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-mc-text-secondary border-b border-mc-border">
                <th className="py-2 pr-2">Agent</th>
                <th className="py-2 pr-2">Memory</th>
                <th className="py-2 pr-2">Soul</th>
                <th className="py-2 pr-2">Agents</th>
                <th className="py-2 pr-2">User</th>
                <th className="py-2">Workspace Path</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b border-mc-border/40">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{agent.name}</div>
                    <div className="text-mc-text-secondary">{agent.role}</div>
                  </td>
                  <td className="py-2 pr-2">{agent.memory_items}</td>
                  <td className="py-2 pr-2">{agent.soul_items}</td>
                  <td className="py-2 pr-2">{agent.agents_items}</td>
                  <td className="py-2 pr-2">{agent.user_items}</td>
                  <td className="py-2 font-mono text-mc-text-secondary max-w-80 truncate">{agent.workspace_path || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
