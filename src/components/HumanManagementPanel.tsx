'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Mail, Plus, RefreshCw, Trash2, UserRound, XCircle } from 'lucide-react';
import type { HimalayaStatus, Human, Workspace } from '@/lib/types';

export function HumanManagementPanel() {
  const [humans, setHumans] = useState<Human[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [himalaya, setHimalaya] = useState<HimalayaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingHuman, setSavingHuman] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newHumanName, setNewHumanName] = useState('');
  const [newHumanEmail, setNewHumanEmail] = useState('');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [himalayaAccount, setHimalayaAccount] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [humansRes, workspaceRes, himalayaRes] = await Promise.all([
        fetch('/api/humans'),
        fetch('/api/workspaces/default'),
        fetch('/api/system/himalaya'),
      ]);

      const humansData = humansRes.ok ? await humansRes.json() : [];
      const workspaceData = workspaceRes.ok ? await workspaceRes.json() : null;
      const himalayaData = himalayaRes.ok ? await himalayaRes.json() : null;

      setHumans(Array.isArray(humansData) ? humansData : []);
      setWorkspace(workspaceData);
      setHimalaya(himalayaData);
      setCoordinatorEmail(workspaceData?.coordinator_email || '');
      setHimalayaAccount(workspaceData?.himalaya_account || himalayaData?.default_account || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load human routing settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData().catch(() => {});
  }, [loadData]);

  const saveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces/default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinator_email: coordinatorEmail.trim() || null,
          himalaya_account: himalayaAccount.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save human routing config');
      }
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save human routing config');
    } finally {
      setSavingConfig(false);
    }
  };

  const createHuman = async () => {
    if (!newHumanName.trim() || !newHumanEmail.trim()) return;
    setSavingHuman(true);
    setError(null);
    try {
      const res = await fetch('/api/humans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHumanName.trim(), email: newHumanEmail.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create human');
      }
      setNewHumanName('');
      setNewHumanEmail('');
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create human');
    } finally {
      setSavingHuman(false);
    }
  };

  const deactivateHuman = async (humanId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/humans/${humanId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove human');
      }
      await loadData();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to remove human');
    }
  };

  const himalayaOk = Boolean(himalaya?.installed && himalaya?.configured && himalaya?.healthy_account && coordinatorEmail.trim());

  return (
    <div data-component="src/components/HumanManagementPanel" className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden">
      <div className="p-4 border-b border-mc-border bg-mc-bg-secondary flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
            <UserRound className="w-4 h-4 text-mc-text-secondary" />
            <span>Human Assignment Routing</span>
          </div>
          <p className="mt-1 text-sm text-mc-text-secondary">
            Manage human assignees and the coordinator sender settings used for Himalaya email delivery.
          </p>
        </div>
        <button
          onClick={() => loadData()}
          className="min-h-11 px-3 py-2 border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary transition-colors text-sm text-mc-text inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className={`rounded-lg border px-3 py-3 text-sm ${himalayaOk ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          <div className="flex items-center gap-2 font-medium">
            {himalayaOk ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span>{himalayaOk ? 'Human email routing ready' : 'Human email routing needs attention'}</span>
          </div>
          <div className="mt-1 text-xs break-all">
            {himalayaOk
              ? `Account ${himalaya?.configured_account} will send from ${coordinatorEmail.trim()}`
              : (himalaya?.error || 'Set coordinator email and a healthy Himalaya account before assigning tasks to humans.')}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-4 space-y-3">
            <div className="text-sm font-medium text-mc-text">Coordinator Sender</div>
            <div>
              <label className="block text-sm font-medium mb-1">From Email</label>
              <input
                type="email"
                value={coordinatorEmail}
                onChange={(e) => setCoordinatorEmail(e.target.value)}
                placeholder="michal@blockether.com"
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Himalaya Account</label>
              <select
                value={himalayaAccount}
                onChange={(e) => setHimalayaAccount(e.target.value)}
                className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                <option value="">Use default Himalaya account</option>
                {(himalaya?.accounts || []).map((account) => (
                  <option key={account.name} value={account.name}>{account.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="min-h-11 px-4 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {savingConfig ? 'Saving...' : 'Save Sender Settings'}
            </button>
          </div>

          <div className="rounded-lg border border-mc-border bg-mc-bg-secondary p-4 space-y-3">
            <div className="text-sm font-medium text-mc-text">Add Human</div>
            <input
              type="text"
              value={newHumanName}
              onChange={(e) => setNewHumanName(e.target.value)}
              placeholder="Name"
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            />
            <input
              type="email"
              value={newHumanEmail}
              onChange={(e) => setNewHumanEmail(e.target.value)}
              placeholder="email@blockether.com"
              className="w-full min-h-11 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            />
            <button
              onClick={createHuman}
              disabled={savingHuman || !newHumanName.trim() || !newHumanEmail.trim()}
              className="min-h-11 px-4 py-2 bg-mc-accent text-white rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {savingHuman ? 'Adding...' : 'Add Human'}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-mc-border bg-mc-bg-secondary overflow-hidden">
          <div className="p-3 border-b border-mc-border bg-mc-bg flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-mc-text">Assignable Humans</div>
            <div className="text-xs text-mc-text-secondary">{loading ? 'Loading...' : `${humans.length} active`}</div>
          </div>
          <div className="divide-y divide-mc-border">
            {humans.map((human) => (
              <div key={human.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-mc-text">{human.name}</div>
                  <div className="text-xs text-mc-text-secondary flex items-center gap-1.5">
                    <Mail className="w-3 h-3" />
                    <span className="truncate">{human.email}</span>
                  </div>
                </div>
                <button
                  onClick={() => deactivateHuman(human.id)}
                  className="min-h-11 px-3 py-2 border border-red-200 rounded text-red-700 hover:bg-red-50 transition-colors inline-flex items-center gap-2 text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              </div>
            ))}
            {!loading && humans.length === 0 && (
              <div className="p-4 text-sm text-mc-text-secondary">No humans configured yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
