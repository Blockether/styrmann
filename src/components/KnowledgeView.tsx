'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Link,
  Loader2,
  Paperclip,
  Plus,
  Route,
  Search,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import type { Agent, KnowledgeAttachment, KnowledgeEntry, KnowledgeLink, KnowledgeRoutingDecision } from '@/lib/types';

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

const KNOWLEDGE_CATEGORIES = [
  { value: 'pattern', label: 'Pattern', description: 'Reusable implementation or workflow pattern.' },
  { value: 'fix', label: 'Fix', description: 'Known issue and the working fix for it.' },
  { value: 'checklist', label: 'Checklist', description: 'Step-by-step operational or verification checklist.' },
  { value: 'failure', label: 'Failure', description: 'Failure mode, root cause, and how to avoid it.' },
  { value: 'research', label: 'Research', description: 'Validated discovery or external reference insight.' },
  { value: 'guideline', label: 'Guideline', description: 'Durable rule or guardrail for future work.' },
] as const;

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
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [linkPickerEntryId, setLinkPickerEntryId] = useState<string | null>(null);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) throw new Error('Failed to load agents');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setAgents(list.filter((agent): agent is Agent => typeof agent?.id === 'string'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load agents');
    }
  }, [workspaceId]);

  const loadEntries = useCallback(async (agentIdFilter: string) => {
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load knowledge');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    loadEntries(selectedAgentId);
  }, [loadEntries, selectedAgentId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
      return `${entry.category} ${entry.title} ${entry.content} ${tags}`.toLowerCase().includes(q);
    });
  }, [entries, query]);

  const toggleExpand = (entryId: string) => {
    setExpandedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

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
      const newEntry: KnowledgeEntry = await res.json();

      // Upload queued files if any
      if (queuedFiles.length > 0) {
        for (const file of queuedFiles) {
          const body = new FormData();
          body.append('file', file);
          await fetch(`/api/workspaces/${workspaceId}/knowledge/${newEntry.id}/attachments`, {
            method: 'POST',
            body,
          });
        }
      }

      setForm(DEFAULT_FORM);
      setQueuedFiles([]);
      setShowCreateModal(false);
      setMessage('Knowledge entry created and routed.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create entry');
    } finally {
      setSaving(false);
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

  const createLink = async (sourceId: string, targetId: string) => {
    setSavingLinkId(sourceId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${sourceId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId }),
      });
      if (!res.ok) throw new Error('Failed to create link');
      setMessage('Entry linked.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create link');
    } finally {
      setSavingLinkId(null);
    }
  };

  const removeLink = async (entryId: string, linkId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entryId}/links`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_id: linkId }),
      });
      if (!res.ok) throw new Error('Failed to remove link');
      setMessage('Link removed.');
      await loadEntries(selectedAgentId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to remove link');
    }
  };

  const handleFileQueue = (files: FileList | null) => {
    if (!files) return;
    setQueuedFiles((current) => [...current, ...Array.from(files)]);
  };

  const removeQueuedFile = (index: number) => {
    setQueuedFiles((current) => current.filter((_, i) => i !== index));
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setForm(DEFAULT_FORM);
    setQueuedFiles([]);
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  };

  const getAgentById = (agentId: string): Agent | undefined => {
    return agents.find((a) => a.id === agentId);
  };

  const getSelectedRoutingBadgeInfo = (entry: KnowledgeEntry): { agent: Agent; selected: boolean }[] => {
    const decisions = (entry.routing_decisions || []) as KnowledgeRoutingDecision[];
    return agents.map((agent) => {
      const decision = decisions.find((d) => d.agent_id === agent.id);
      return { agent, selected: decision?.selected ?? false };
    });
  };

  const linkableEntries = (sourceId: string): KnowledgeEntry[] => {
    const linkedIds = new Set(
      (entries.find((e) => e.id === sourceId)?.linked_entries || []).map((l) => l.target_id)
    );
    return entries.filter((e) => e.id !== sourceId && !linkedIds.has(e.id));
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
      {/* Toolbar */}
      <div className="p-3 border-b border-mc-border bg-mc-bg-secondary flex items-center justify-between gap-2 flex-wrap rounded-lg">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-mc-text-secondary" />
          <h2 className="text-sm font-medium">Knowledge</h2>
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
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary min-h-11"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Entry</span>
          </button>
        </div>
      </div>

      {message && <div className="text-xs text-mc-text-secondary">{message}</div>}

      {/* Entry List */}
      <div className="space-y-2">
        {filtered.map((entry) => {
          const attachments = (entry.attachments || []) as KnowledgeAttachment[];
          const linkedEntries = (entry.linked_entries || []) as KnowledgeLink[];
          const isExpanded = expandedEntryIds.has(entry.id);
          const isManuallyCreated = !entry.created_by_agent_id;
          const routingBadges = getSelectedRoutingBadgeInfo(entry);

          return (
            <div key={entry.id} className="border border-mc-border rounded-lg overflow-hidden">
              {/* Collapsed Header */}
              <div
                onClick={() => toggleExpand(entry.id)}
                className="p-3 bg-mc-bg-secondary cursor-pointer hover:bg-mc-bg-tertiary flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <span className="text-xs font-medium px-2 py-0.5 bg-mc-bg-tertiary rounded border border-mc-border shrink-0">
                    {entry.category}
                  </span>
                  <span className="text-sm font-medium truncate">{entry.title}</span>
                  <span className="text-xs text-mc-text-secondary hidden sm:inline">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </span>
                  {/* Auto-routing badges */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {routingBadges.filter((b) => b.selected).map((b) => (
                      <span
                        key={b.agent.id}
                        className="text-xs px-1.5 py-0.5 bg-green-100 text-green-800 rounded border border-green-200 flex items-center gap-1"
                      >
                        <Bot className="w-3 h-3" />
                        {b.agent.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-mc-text-secondary shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-mc-text-secondary shrink-0" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="p-4 space-y-4 border-t border-mc-border">
                  {/* Meta row */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-mc-text-secondary">
                      Confidence: {(entry.confidence * 100).toFixed(0)}%
                      {entry.created_by_agent_id && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Bot className="w-3 h-3" /> Created by agent
                        </span>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEntry(entry.id);
                      }}
                      className="px-2 py-1 border border-mc-border rounded text-xs hover:bg-red-50 hover:border-red-300 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>

                  {/* Content */}
                  <p className="text-sm text-mc-text whitespace-pre-wrap">{entry.content}</p>

                  {/* Tags */}
                  {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-mc-text-secondary">Tags:</span>
                      {entry.tags.map((tag, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-mc-bg-tertiary rounded border border-mc-border">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Auto-routing display (read-only) */}
                  <div className="border border-mc-border/70 rounded p-3 space-y-2">
                    <div className="text-xs font-medium inline-flex items-center gap-2">
                      <Route className="w-3.5 h-3.5" /> Auto-Routing
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {routingBadges.map((b) => (
                        <span
                          key={b.agent.id}
                          className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${
                            b.selected
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border'
                          }`}
                        >
                          <Bot className="w-3 h-3" />
                          {b.agent.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Attachments */}
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
                            <div className="min-w-0">
                              <div className="font-medium truncate">{attachment.file_name}</div>
                              <div className="text-mc-text-secondary">
                                {attachment.mime_type || 'unknown'} / {attachment.size_bytes || 0} bytes
                                {attachment.source_url && <span className="block truncate">{attachment.source_url}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap shrink-0">
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
                              {isManuallyCreated && (
                                <button
                                  onClick={() => removeAttachment(entry.id, attachment.id)}
                                  className="px-2 py-1 border border-mc-border rounded hover:bg-red-50 hover:border-red-300"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* File upload UI - only for manually created entries */}
                    {isManuallyCreated && (
                      <div className="flex items-center gap-2 flex-wrap pt-2">
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
                          className="px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 min-h-11"
                        >
                          {uploadingEntryId === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Attach URL'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Linked Entries */}
                  <div className="border border-mc-border/70 rounded p-3 space-y-2">
                    <div className="text-xs font-medium inline-flex items-center gap-2">
                      <Link className="w-3.5 h-3.5" /> Linked Entries
                    </div>

                    {linkedEntries.length === 0 ? (
                      <div className="text-xs text-mc-text-secondary">No linked entries.</div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        {linkedEntries.map((link) => (
                          <span
                            key={link.id}
                            className="text-xs px-2 py-1 bg-mc-bg-tertiary rounded border border-mc-border flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />
                            {link.linked_entry?.title || 'Unknown'}
                            <button
                              onClick={() => removeLink(entry.id, link.id)}
                              className="ml-1 hover:text-red-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Link picker */}
                    <div className="relative pt-2">
                      <button
                        onClick={() => setLinkPickerEntryId(linkPickerEntryId === entry.id ? null : entry.id)}
                        disabled={savingLinkId === entry.id}
                        className="px-3 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 inline-flex items-center gap-2"
                      >
                        {savingLinkId === entry.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Link className="w-3.5 h-3.5" />
                        )}
                        Link Entry
                      </button>

                      {linkPickerEntryId === entry.id && (
                        <div className="absolute z-10 mt-2 w-72 max-h-64 overflow-auto bg-mc-bg border border-mc-border rounded-lg shadow-lg">
                          <div className="p-2 border-b border-mc-border text-xs text-mc-text-secondary">
                            Select an entry to link
                          </div>
                          <div className="p-1">
                            {linkableEntries(entry.id).length === 0 ? (
                              <div className="p-2 text-xs text-mc-text-secondary">No entries available to link</div>
                            ) : (
                              linkableEntries(entry.id).map((target) => (
                                <button
                                  key={target.id}
                                  onClick={() => {
                                    createLink(entry.id, target.id);
                                    setLinkPickerEntryId(null);
                                  }}
                                  className="w-full text-left px-2 py-2 text-sm hover:bg-mc-bg-tertiary rounded flex items-center gap-2"
                                >
                                  <span className="text-xs px-1.5 py-0.5 bg-mc-bg-tertiary rounded border border-mc-border shrink-0">
                                    {target.category}
                                  </span>
                                  <span className="truncate">{target.title}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />

          {/* Modal Card */}
          <div className="relative w-full max-w-2xl bg-mc-bg border border-mc-border rounded-lg shadow-xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-3 border-b border-mc-border flex items-center justify-between shrink-0">
              <h3 className="text-sm font-medium">Create Knowledge Entry</h3>
              <button onClick={closeModal} className="p-1 hover:bg-mc-bg-tertiary rounded">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div ref={modalScrollRef} className="p-4 space-y-3 overflow-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-mc-text-secondary mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                    className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  >
                    {KNOWLEDGE_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                  <div className="text-xs text-mc-text-secondary mt-1">
                    {KNOWLEDGE_CATEGORIES.find((category) => category.value === form.category)?.description}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-mc-text-secondary mb-1">Confidence</label>
                  <input
                    type="number"
                    step="0.05"
                    min={0.1}
                    max={1}
                    value={form.confidence}
                    onChange={(event) => setForm({ ...form, confidence: Number(event.target.value) || 0.7 })}
                    className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Title"
                  className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1">Content</label>
                <textarea
                  value={form.content}
                  onChange={(event) => setForm({ ...form, content: event.target.value })}
                  placeholder="Durable learning or rule"
                  className="w-full min-h-24 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-mc-text-secondary mb-1">Tags (comma-separated)</label>
                <input
                  value={form.tags}
                  onChange={(event) => setForm({ ...form, tags: event.target.value })}
                  placeholder="Tags (comma-separated)"
                  className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                />
              </div>

              {/* File Upload Section */}
              <div className="border border-mc-border/70 rounded p-3 space-y-2">
                <div className="text-xs font-medium inline-flex items-center gap-2">
                  <Upload className="w-3.5 h-3.5" /> Attachments
                </div>

                {/* Drag and drop area */}
                <div
                  className="border-2 border-dashed border-mc-border rounded p-4 text-center cursor-pointer hover:bg-mc-bg-tertiary"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFileQueue(e.dataTransfer.files);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <Upload className="w-6 h-6 mx-auto text-mc-text-secondary mb-2" />
                  <div className="text-sm text-mc-text-secondary">
                    Drag files here or click to browse
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFileQueue(e.target.files)}
                  />
                </div>

                {/* Queued files list */}
                {queuedFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-mc-text-secondary">Files to upload:</div>
                    {queuedFiles.map((file, index) => (
                      <div key={index} className="text-xs flex items-center justify-between bg-mc-bg-tertiary rounded px-2 py-1">
                        <span className="truncate flex-1">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeQueuedFile(index);
                          }}
                          className="ml-2 p-0.5 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-mc-border p-3 flex justify-end gap-2 shrink-0">
              <button
                onClick={closeModal}
                className="px-4 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary"
              >
                Cancel
              </button>
              <button
                onClick={createEntry}
                disabled={saving || !form.title.trim() || !form.content.trim()}
                className="px-4 py-2 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
