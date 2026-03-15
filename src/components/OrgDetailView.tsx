'use client';
import { Ticket, BookOpen, Folder, Plus, Zap, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { OrgTicket, OrgSprint, KnowledgeArticle } from '@/lib/types';
import { OrgTicketCreateModal } from '@/components/OrgTicketCreateModal';
import { Header } from '@/components/Header';

interface DelegatedTask {
  id: string;
  title: string;
  status: string;
  workspace_id: string;
}

interface DelegationInfo {
  tasks: DelegatedTask[];
  workspaceName: string;
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  workspaces?: Array<{ id: string; name: string; slug: string }>;
}

function OrgDetailViewInner({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get('tab') || 'tickets') as 'sprints' | 'tickets' | 'knowledge' | 'workspaces';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [tickets, setTickets] = useState<OrgTicket[]>([]);
  const [sprints, setSprints] = useState<OrgSprint[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSprintForm, setShowSprintForm] = useState(false);
  const [sprintName, setSprintName] = useState('');
  const [sprintStatus, setSprintStatus] = useState<'planned' | 'active' | 'completed'>('planned');
  const [sprintStartDate, setSprintStartDate] = useState('');
  const [sprintEndDate, setSprintEndDate] = useState('');
  const [sprintSubmitting, setSprintSubmitting] = useState(false);
  const [expandedSprint, setExpandedSprint] = useState<string | null>(null);
  const [sprintTickets, setSprintTickets] = useState<Map<string, OrgTicket[]>>(new Map());
  const [delegationInfo, setDelegationInfo] = useState<Map<string, DelegationInfo>>(new Map());

  useEffect(() => {
    fetch(`/api/organizations/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setOrg(data);
        setLoading(false);
        if (data?.id) {
          const workspaces = data.workspaces || [];
          const workspaceMap = new Map(workspaces.map((ws: { id: string; name: string }) => [ws.id, ws.name]));

          Promise.all([
            fetch(`/api/org-tickets?organization_id=${data.id}`).then(r => r.json()),
            fetch(`/api/knowledge?organization_id=${data.id}`).then(r => r.json()),
            fetch(`/api/org-sprints?organization_id=${data.id}`).then(r => r.json()),
          ]).then(([t, k, s]) => {
            const ticketsList = Array.isArray(t) ? t : [];
            setTickets(ticketsList);
            setKnowledge(Array.isArray(k) ? k : []);
            setSprints(Array.isArray(s) ? s : []);

            const delegatedTickets = ticketsList.filter((ticket: OrgTicket) =>
              ['delegated', 'in_progress'].includes(ticket.status)
            );
            if (delegatedTickets.length > 0) {
              Promise.all(
                delegatedTickets.map((ticket: OrgTicket) =>
                  fetch(`/api/org-tickets/${ticket.id}`).then(r => r.json())
                )
              ).then(details => {
                const infoMap = new Map<string, DelegationInfo>();
                for (const detail of details) {
                  const tasks = detail.delegated_tasks as DelegatedTask[] | undefined;
                  if (tasks && tasks.length > 0) {
                    const firstTask = tasks[0];
                    const wsId = String(firstTask.workspace_id);
                    const wsName = workspaceMap.get(wsId);
                    infoMap.set(String(detail.id), {
                      tasks: tasks,
                      workspaceName: wsName && typeof wsName === 'string' ? wsName : 'workspace',
                    });
                  }
                }
                setDelegationInfo(infoMap);
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="p-6 text-sm text-mc-text-secondary">Loading...</div>;
  if (!org) return <div className="p-6 text-sm text-mc-text-secondary">Organization not found.</div>;

  const workspaces = org.workspaces || [];
  const STATUS_COLORS: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    triaged: 'bg-yellow-100 text-yellow-800',
    delegated: 'bg-purple-100 text-purple-800',
    in_progress: 'bg-orange-100 text-orange-800',
    resolved: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-600',
  };

  return (
    <div data-component="src/components/OrgDetailView" className="min-h-screen bg-mc-bg">
      <Header />

      {org.description && (
        <div className="px-6 py-2 border-b border-mc-border text-xs text-mc-text-secondary">{org.description}</div>
      )}

      <div className="flex gap-0 border-b border-mc-border bg-mc-bg-secondary">
        {(['sprints', 'tickets', 'knowledge', 'workspaces'] as const).map(tab => (
          <Link
            key={tab}
            href={`?tab=${tab}`}
            className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-mc-accent text-mc-text'
                : 'border-transparent text-mc-text-secondary hover:text-mc-text'
            }`}
          >
            {tab === 'sprints' && <><Layers size={12} className="inline mr-1" /><span className="hidden sm:inline">Sprints</span><span className="sm:hidden">S</span></>}
            {tab === 'tickets' && <><Ticket size={12} className="inline mr-1" /><span className="hidden sm:inline">Tickets</span><span className="sm:hidden">T</span></>}
            {tab === 'knowledge' && <><BookOpen size={12} className="inline mr-1" /><span className="hidden sm:inline">Knowledge</span><span className="sm:hidden">K</span></>}
            {tab === 'workspaces' && <><Folder size={12} className="inline mr-1" /><span className="hidden sm:inline">Workspaces</span><span className="sm:hidden">W</span></>}
          </Link>
        ))}
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        {activeTab === 'sprints' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono text-sm font-semibold text-mc-text">Sprints ({sprints.length})</h2>
              <button
                onClick={() => setShowSprintForm(!showSprintForm)}
                className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 flex items-center gap-1"
              >
                <Plus size={12} />
                <span className="hidden sm:inline">Create Sprint</span>
              </button>
            </div>

            {showSprintForm && (
              <div className="p-3 rounded border border-mc-border bg-mc-bg-secondary mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-mc-text-secondary mb-1">Name *</label>
                    <input
                      type="text"
                      value={sprintName}
                      onChange={e => setSprintName(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                      placeholder="Sprint name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-mc-text-secondary mb-1">Status</label>
                    <select
                      value={sprintStatus}
                      onChange={e => setSprintStatus(e.target.value as typeof sprintStatus)}
                      className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    >
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-mc-text-secondary mb-1">Start Date</label>
                    <input
                      type="date"
                      value={sprintStartDate}
                      onChange={e => setSprintStartDate(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-mc-text-secondary mb-1">End Date</label>
                    <input
                      type="date"
                      value={sprintEndDate}
                      onChange={e => setSprintEndDate(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-mono border border-mc-border rounded bg-mc-bg text-mc-text focus:outline-none focus:border-mc-accent"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowSprintForm(false); setSprintName(''); setSprintStartDate(''); setSprintEndDate(''); setSprintStatus('planned'); }}
                    className="px-3 py-1.5 text-xs font-mono text-mc-text-secondary hover:text-mc-text border border-mc-border rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={sprintSubmitting || !sprintName.trim()}
                    onClick={async () => {
                      if (!sprintName.trim() || !org) return;
                      setSprintSubmitting(true);
                      try {
                        const res = await fetch('/api/org-sprints', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            organization_id: org.id,
                            name: sprintName.trim(),
                            status: sprintStatus,
                            start_date: sprintStartDate || undefined,
                            end_date: sprintEndDate || undefined,
                          }),
                        });
                        if (res.ok) {
                          const created = await res.json();
                          setSprints(prev => [created, ...prev]);
                          setShowSprintForm(false);
                          setSprintName('');
                          setSprintStartDate('');
                          setSprintEndDate('');
                          setSprintStatus('planned');
                        }
                      } finally {
                        setSprintSubmitting(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Create
                  </button>
                </div>
              </div>
            )}

            {sprints.length === 0 ? (
              <div className="text-sm text-mc-text-secondary">No sprints yet.</div>
            ) : (
              <div className="space-y-2">
                {sprints.map(sprint => {
                  const ticketCount = tickets.filter(t => t.org_sprint_id === sprint.id).length;
                  const isExpanded = expandedSprint === sprint.id;
                  const SPRINT_STATUS_COLORS: Record<string, string> = {
                    planned: 'bg-gray-100 text-gray-700',
                    active: 'bg-green-100 text-green-800',
                    completed: 'bg-blue-100 text-blue-800',
                  };
                  return (
                    <div key={sprint.id} className="rounded border border-mc-border bg-mc-bg-secondary">
                      <button
                        type="button"
                        className="w-full p-3 text-left"
                        onClick={() => {
                          const next = isExpanded ? null : sprint.id;
                          setExpandedSprint(next);
                          if (next && !sprintTickets.has(sprint.id)) {
                            fetch(`/api/org-sprints/${sprint.id}`)
                              .then(r => r.json())
                              .then(data => {
                                if (data.tickets) {
                                  setSprintTickets(prev => new Map(prev).set(sprint.id, data.tickets));
                                }
                              })
                              .catch(() => {});
                          }
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} className="text-mc-text-secondary" /> : <ChevronRight size={14} className="text-mc-text-secondary" />}
                            <span className="font-mono text-sm text-mc-text">{sprint.name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${SPRINT_STATUS_COLORS[sprint.status] || 'bg-gray-100 text-gray-700'}`}>
                              {sprint.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-mc-text-secondary font-mono">
                            {sprint.start_date && sprint.end_date && (
                              <span>{sprint.start_date} - {sprint.end_date}</span>
                            )}
                            <span>{ticketCount} ticket{ticketCount !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 border-t border-mc-border">
                          {(sprintTickets.get(sprint.id) || []).length === 0 ? (
                            <p className="text-xs text-mc-text-secondary pt-2">No tickets assigned to this sprint.</p>
                          ) : (
                            <div className="space-y-1 pt-2">
                              {(sprintTickets.get(sprint.id) || []).map(t => (
                                <div key={t.id} className="flex items-center justify-between gap-2 p-2 rounded bg-mc-bg border border-mc-border">
                                  <span className="text-xs font-mono text-mc-text truncate">{t.title}</span>
                                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono shrink-0 ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>
                                    {t.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'tickets' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono text-sm font-semibold text-mc-text">Tickets ({tickets.length})</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1.5 text-xs font-mono bg-mc-accent text-white rounded hover:opacity-90 flex items-center gap-1"
              >
                <Plus size={12} />
                <span className="hidden sm:inline">Create Ticket</span>
              </button>
            </div>
            {tickets.length === 0 ? (
              <div className="text-sm text-mc-text-secondary">No tickets yet.</div>
            ) : (
              <div className="space-y-2">
                {tickets.map(ticket => (
                  <div key={ticket.id} className="p-3 rounded border border-mc-border bg-mc-bg-secondary">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                       <div className="flex items-center gap-2 min-w-0">
                         <span className="font-mono text-sm text-mc-text truncate">{ticket.title}</span>
                         {ticket.org_sprint_id && sprints.find(s => s.id === ticket.org_sprint_id) && (
                           <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-mc-bg border border-mc-border text-mc-text-secondary shrink-0">
                             {sprints.find(s => s.id === ticket.org_sprint_id)?.name}
                           </span>
                         )}
                       </div>
                       <span className={`text-xs px-1.5 py-0.5 rounded font-mono shrink-0 ${STATUS_COLORS[ticket.status] || 'bg-gray-100 text-gray-600'}`}>
                         {ticket.status}
                       </span>
                     </div>
                    {delegationInfo.has(ticket.id) && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-mc-text-secondary">
                        <Zap size={10} className="text-mc-accent" />
                        <span>{delegationInfo.get(ticket.id)?.tasks.length} task{delegationInfo.get(ticket.id)?.tasks.length !== 1 ? 's' : ''} delegated</span>
                        <span>to</span>
                        <span className="font-medium text-mc-text">{delegationInfo.get(ticket.id)?.workspaceName}</span>
                      </div>
                    )}
                    {ticket.description && (
                      <p className="mt-1 text-xs text-mc-text-secondary line-clamp-2">{ticket.description}</p>
                    )}
                    <div className="mt-2 flex gap-2 text-xs text-mc-text-secondary">
                      <span>{ticket.priority}</span>
                      <span>|</span>
                      <span>{ticket.ticket_type}</span>
                      {ticket.external_ref && <><span>|</span><span>{ticket.external_ref}</span></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div>
            <h2 className="font-mono text-sm font-semibold text-mc-text mb-4">Knowledge ({knowledge.length})</h2>
            {knowledge.length === 0 ? (
              <div className="text-sm text-mc-text-secondary">No knowledge articles yet. Add memories to enable synthesis.</div>
            ) : (
              <div className="space-y-2">
                {knowledge.map(article => (
                  <div key={article.id} className="p-3 rounded border border-mc-border bg-mc-bg-secondary">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-mc-text">{article.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${article.status === 'stale' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                        {article.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-mc-text-secondary line-clamp-2">{article.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'workspaces' && (
          <div>
            <h2 className="font-mono text-sm font-semibold text-mc-text mb-4">Workspaces ({workspaces.length})</h2>
            {workspaces.length === 0 ? (
              <div className="text-sm text-mc-text-secondary">No workspaces in this organization.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {workspaces.map(ws => (
                  <Link
                    key={ws.id}
                    href={`/workspace/${ws.slug}`}
                    className="block p-3 rounded border border-mc-border bg-mc-bg-secondary hover:border-mc-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={14} className="text-mc-accent shrink-0" />
                      <span className="font-mono text-sm text-mc-text">{ws.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-mc-text-secondary font-mono">{ws.slug}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateModal && org && (
        <OrgTicketCreateModal
          organizationId={org.id}
          onClose={() => setShowCreateModal(false)}
          onCreated={(ticket) => {
            setTickets(prev => [ticket, ...prev]);
            setShowCreateModal(false);
          }}
        />
      )}
    </div>
  );
}

export function OrgDetailView({ slug }: { slug: string }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mc-text-secondary">Loading...</div>}>
      <OrgDetailViewInner slug={slug} />
    </Suspense>
  );
}
