'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Paperclip, Pencil, Plus, Route, Search, Trash2, Upload } from 'lucide-react';
import type { Agent, KnowledgeAttachment, KnowledgeEntry, KnowledgeRoutingDecision } from '@/lib/types';

interface KnowledgeViewProps {
  workspaceId: string;
}

type EntryForm = {
  category: string;
  title: string;
  content: string;
  tags: string;
  confidence: number;
};

const DEFAULT_FORM: EntryForm = {
  category: 'pattern',
  title: '',
  content: '',
  tags: '',
  confidence: 0.7,
};

function toArrayTags(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function fromTags(tags: string[] | undefined): string {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

export function KnowledgeView({ workspaceId }: KnowledgeViewProps) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('all');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<EntryForm>(DEFAULT_FORM);
  const [uploadingEntryId, setUploadingEntryId] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryForm>(DEFAULT_FORM);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, string[]>>({});
  const [savingRouteEntryId, setSavingRouteEntryId] = useState<string | null>(null);

  const loadAgents = async () => {
    try {
      const res = await fetch(`/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) throw new Error('Failed to load agents');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setAgents(list.filter((agent): agent is Agent => typeof agent?.id === 'string'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load agents');
    }
  };

  const loadEntries = async (agentIdFilter: string) => {
    setLoading(true);
    try {
      const url = new URL(`/api/workspaces/${workspaceId}/knowledge`, window.location.origin);
      url.searchParams.set('limit', '200');
      if (agentIdFilter !== 'all') url.searchParams.set('agent_id', agentIdFilter);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to load knowledge entries');
      const data = await res.json();
      const records = Array.isArray(data) ? data : [];
      setEntries(records);
      setRouteDrafts((current) => {
        const next = { ...current };
        for (const record of records) {
          const selected = Array.isArray(record.routing_decisions)
            ? (record.routing_decisions as KnowledgeRoutingDecision[])
              .filter((decision) => decision.selected && !!decision.agent_id)
              .map((decision) => decision.agent_id as string)
            : [];
          next[record.id] = selected;
        }
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load knowledge');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, [workspaceId]);

  useEffect(() => {
    loadEntries(selectedAgentId);
  }, [workspaceId, selectedAgentId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
      return `${entry.category} ${entry.title} ${entry.content} ${tags}`.toLowerCase().includes(q);
    });
  }, [entries, query]);

  const createEntry = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setMessage('Title and content are required.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          title: form.title.trim(),
          content: form.content.trim(),
          tags: toArrayTags(form.tags),
          confidence: Math.max(0.1, Math.min(1, Number(form.confidence) || 0.7)),
        }),
      });

      if (!res.ok) throw new Error('Failed to create knowledge entry');
      setForm(DEFAULT_FORM);
      setMessage('Knowledge entry created and routed.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create entry');
    } finally {
      setSaving(false);
    }
  };

  const startEditEntry = (entry: KnowledgeEntry) => {
    setEditingEntryId(entry.id);
    setEditForm({
      category: entry.category,
      title: entry.title,
      content: entry.content,
      tags: fromTags(entry.tags),
      confidence: Number(entry.confidence || 0.7),
    });
  };

  const saveEditEntry = async (entryId: string) => {
    if (!editForm.title.trim() || !editForm.content.trim()) {
      setMessage('Title and content are required.');
      return;
    }

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editForm.category,
          title: editForm.title.trim(),
          content: editForm.content.trim(),
          tags: toArrayTags(editForm.tags),
          confidence: Math.max(0.1, Math.min(1, Number(editForm.confidence) || 0.7)),
        }),
      });
      if (!res.ok) throw new Error('Failed to update entry');
      setEditingEntryId(null);
      setMessage('Knowledge entry updated.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update entry');
    }
  };

  const deleteEntry = async (entryId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete entry');
      setMessage('Knowledge entry deleted.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete entry');
    }
  };

  const toggleRoute = (entryId: string, agentId: string) => {
    setRouteDrafts((current) => {
      const selected = new Set(current[entryId] || []);
      if (selected.has(agentId)) {
        selected.delete(agentId);
      } else {
        selected.add(agentId);
      }
      return { ...current, [entryId]: Array.from(selected) };
    });
  };

  const saveRouteOverride = async (entryId: string) => {
    const routeAgentIds = routeDrafts[entryId] || [];
    if (routeAgentIds.length === 0) {
      setMessage('Select at least one agent for routing.');
      return;
    }

    setSavingRouteEntryId(entryId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routing_agent_ids: routeAgentIds }),
      });
      if (!res.ok) throw new Error('Failed to save route override');
      setMessage('Routing override saved.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save route override');
    } finally {
      setSavingRouteEntryId(null);
    }
  };

  const uploadAttachment = async (entryId: string, file: File) => {
    setUploadingEntryId(entryId);
    setMessage('');
    try {
      const body = new FormData();
      body.append('file', file);
      const sourceUrl = attachmentUrls[entryId];
      if (sourceUrl?.trim()) body.append('source_url', sourceUrl.trim());

      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}/attachments`, {
        method: 'POST',
        body,
      });
      if (!res.ok) throw new Error('Failed to upload attachment');

      setMessage('Attachment uploaded.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to upload attachment');
    } finally {
      setUploadingEntryId(null);
    }
  };

  const attachUrl = async (entryId: string) => {
    const sourceUrl = attachmentUrls[entryId]?.trim();
    if (!sourceUrl) return;
    setUploadingEntryId(entryId);
    setMessage('');

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: 'reference-url.txt',
          mime_type: 'text/uri-list',
          source_url: sourceUrl,
          content_text: sourceUrl,
        }),
      });
      if (!res.ok) throw new Error('Failed to attach URL');

      setAttachmentUrls((current) => ({ ...current, [entryId]: '' }));
      setMessage('Reference URL attached.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to attach URL');
    } finally {
      setUploadingEntryId(null);
    }
  };

  const removeAttachment = async (entryId: string, attachmentId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove attachment');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to remove attachment');
    }
  };

  if (loading) {
    return (
      <div data-component="src/components/KnowledgeView" className="h-full flex items-center justify-center text-mc-text-secondary">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading knowledge...
      </div>
    );
  }

  return (
    <div data-component="src/components/KnowledgeView" className="h-full overflow-auto p-4 sm:p-6 space-y-4">
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap rounded-lg">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-mc-text-secondary" />
          <h2 className="text-sm font-medium">Knowledge and Routing</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mc-text-secondary" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge..."
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
          >
            <option value="all">All routed agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>
      </div>

      {message && <div className="text-xs text-mc-text-secondary">{message}</div>}

      <div className="border border-mc-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Create Knowledge Entry</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            placeholder="Category"
            className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.05"
            min={0.1}
            max={1}
            value={form.confidence}
            onChange={(event) => setForm({ ...form, confidence: Number(event.target.value) || 0.7 })}
            className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
          />
        </div>
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Title"
          className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
        />
        <textarea
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          placeholder="Durable learning or rule"
          className="w-full min-h-24 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
        />
        <input
          value={form.tags}
          onChange={(event) => setForm({ ...form, tags: event.target.value })}
          placeholder="Tags (comma-separated)"
          className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
        />
        <button
          onClick={createEntry}
          disabled={saving}
          className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create and Route
        </button>
      </div>

      <div className="space-y-3">
        {filtered.map((entry) => {
          const attachments = (entry.attachments || []) as KnowledgeAttachment[];
          const decisions = (entry.routing_decisions || []) as KnowledgeRoutingDecision[];
          const draftRoutes = routeDrafts[entry.id] || [];
          const inEdit = editingEntryId === entry.id;

          return (
            <div key={entry.id} className="border border-mc-border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-mc-text-secondary">{entry.category} · confidence {(entry.confidence * 100).toFixed(0)}%</div>
                  <h3 className="text-sm font-medium mt-1">{entry.title}</h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs text-mc-text-secondary">{new Date(entry.created_at).toLocaleString()}</div>
                  <button
                    onClick={() => (inEdit ? setEditingEntryId(null) : startEditEntry(entry))}
                    className="px-2 py-1 border border-mc-border rounded text-xs hover:bg-mc-bg-tertiary inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" /> {inEdit ? 'Cancel' : 'Edit'}
                  </button>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="px-2 py-1 border border-mc-border rounded text-xs hover:bg-mc-bg-tertiary inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>

              {inEdit ? (
                <div className="space-y-2 border border-mc-border/70 rounded p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={editForm.category}
                      onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}
                      className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      step="0.05"
                      min={0.1}
                      max={1}
                      value={editForm.confidence}
                      onChange={(event) => setEditForm({ ...editForm, confidence: Number(event.target.value) || 0.7 })}
                      className="min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <input
                    value={editForm.title}
                    onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                    className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  />
                  <textarea
                    value={editForm.content}
                    onChange={(event) => setEditForm({ ...editForm, content: event.target.value })}
                    className="w-full min-h-24 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  />
                  <input
                    value={editForm.tags}
                    onChange={(event) => setEditForm({ ...editForm, tags: event.target.value })}
                    className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => saveEditEntry(entry.id)}
                    className="px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary"
                  >
                    Save Entry
                  </button>
                </div>
              ) : (
                <p className="text-sm text-mc-text-secondary whitespace-pre-wrap">{entry.content}</p>
              )}

              <div className="border border-mc-border/70 rounded p-3 space-y-2">
                <div className="text-xs font-medium inline-flex items-center gap-2">
                  <Route className="w-3.5 h-3.5" /> Routing Transparency
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {agents.map((agent) => {
                    const checked = draftRoutes.includes(agent.id);
                    return (
                      <label key={`${entry.id}-${agent.id}`} className="text-xs border border-mc-border/60 rounded px-2 py-2 inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRoute(entry.id, agent.id)}
                        />
                        <span>{agent.name}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  onClick={() => saveRouteOverride(entry.id)}
                  disabled={savingRouteEntryId === entry.id}
                  className="px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
                >
                  {savingRouteEntryId === entry.id ? 'Saving routing...' : 'Save Route Override'}
                </button>

                {decisions.length === 0 ? (
                  <div className="text-xs text-mc-text-secondary">No routing details recorded.</div>
                ) : (
                  decisions.map((decision) => (
                    <div key={decision.id || `${decision.agent_id}-${decision.score}`} className="text-xs border border-mc-border/60 rounded p-2">
                      <div className="font-medium">
                        {(decision.agent_name || decision.agent_id || 'unknown')} ({decision.agent_role || 'n/a'}) · score {decision.score.toFixed(2)} · {decision.selected ? 'selected' : 'not selected'}
                      </div>
                      {Array.isArray(decision.reasons) && decision.reasons.length > 0 && (
                        <div className="text-mc-text-secondary mt-1">{decision.reasons.join(' ')}</div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="border border-mc-border/70 rounded p-3 space-y-2">
                <div className="text-xs font-medium inline-flex items-center gap-2">
                  <Paperclip className="w-3.5 h-3.5" /> Attachments
                </div>

                {attachments.length === 0 ? (
                  <div className="text-xs text-mc-text-secondary">No attachments.</div>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="text-xs border border-mc-border/60 rounded p-2 flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-medium">{attachment.file_name}</div>
                          <div className="text-mc-text-secondary">
                            {attachment.mime_type || 'unknown'} · {attachment.size_bytes || 0} bytes
                            {attachment.source_url ? ` · ${attachment.source_url}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`/api/workspaces/${workspaceId}/knowledge/${entry.id}/attachments/${attachment.id}/preview`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 border border-mc-border rounded hover:bg-mc-bg-tertiary"
                          >
                            Preview
                          </a>
                          <a
                            href={`/api/workspaces/${workspaceId}/knowledge/${entry.id}/attachments/${attachment.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 border border-mc-border rounded hover:bg-mc-bg-tertiary"
                          >
                            Download
                          </a>
                          <button
                            onClick={() => removeAttachment(entry.id, attachment.id)}
                            className="px-2 py-1 border border-mc-border rounded hover:bg-mc-bg-tertiary"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm cursor-pointer hover:bg-mc-bg-tertiary">
                    <Upload className="w-4 h-4" />
                    <span className="hidden sm:inline">Upload File</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          uploadAttachment(entry.id, file);
                          event.currentTarget.value = '';
                        }
                      }}
                      disabled={uploadingEntryId === entry.id}
                    />
                  </label>

                  <input
                    value={attachmentUrls[entry.id] || ''}
                    onChange={(event) => setAttachmentUrls((current) => ({ ...current, [entry.id]: event.target.value }))}
                    placeholder="https://docs.example.com/..."
                    className="min-h-11 flex-1 min-w-60 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => attachUrl(entry.id)}
                    disabled={uploadingEntryId === entry.id || !(attachmentUrls[entry.id] || '').trim()}
                    className="px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50"
                  >
                    {uploadingEntryId === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Attach URL'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
