'use client';

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Activity, Bot, Cpu, Mail } from 'lucide-react';
import { OpenClawPanel } from './OpenClawPanel';
import { HumanManagementPanel } from './HumanManagementPanel';
import { SystemPanel } from './SystemPanel';

type OperationsTab = 'system' | 'gateway' | 'agents' | 'humans';
const TAB_ORDER: OperationsTab[] = ['system', 'gateway', 'agents', 'humans'];

function resolveOperationsTabFromHash(hash: string): OperationsTab | null {
  const normalized = hash.replace(/^#/, '').toLowerCase();
  if (!normalized) return null;
  if (normalized === 'system' || normalized === 'system-runtime') return 'system';
  if (normalized === 'gateway' || normalized === 'openclaw') return 'gateway';
  if (normalized === 'agents') return 'agents';
  if (normalized === 'humans') return 'humans';
  return null;
}

export function OperationsDashboard() {
  const [activeTab, setActiveTab] = useState<OperationsTab>('gateway');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateFromHash = (replaceIfMissing: boolean) => {
      const resolved = resolveOperationsTabFromHash(window.location.hash);
      if (resolved) {
        setActiveTab(resolved);
        return;
      }

      setActiveTab('gateway');
      if (replaceIfMissing) {
        const url = new URL(window.location.href);
        url.hash = 'gateway';
        window.history.replaceState({}, '', url.toString());
      }
    };

    updateFromHash(true);

    const onHashChange = () => updateFromHash(false);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const switchTab = useCallback((tab: OperationsTab) => {
    setActiveTab(tab);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.hash = tab;
    window.history.pushState({}, '', url.toString());
  }, []);

  const handleTabListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % TAB_ORDER.length;
      switchTab(TAB_ORDER[nextIndex]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prevIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      switchTab(TAB_ORDER[prevIndex]);
    }
  }, [activeTab, switchTab]);

  return (
    <div data-component="src/components/OperationsDashboard" className="min-h-screen bg-mc-bg">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-base font-semibold text-mc-text">Operations</h1>
          </div>

          <div
            role="tablist"
            aria-label="Operations sections"
            onKeyDown={handleTabListKeyDown}
            className="flex items-end gap-1 overflow-x-auto border-b border-mc-border"
          >
              <button
                role="tab"
                aria-selected={activeTab === 'system'}
                aria-controls="operations-panel-system"
                id="operations-tab-system"
                onClick={() => switchTab('system')}
                className={`inline-flex items-center justify-center gap-2 px-3 min-h-11 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'system' ? 'border-mc-accent text-mc-text' : 'border-transparent text-mc-text-secondary hover:text-mc-text'}`}
              >
                <Activity className="h-4 w-4" />
                <span>System</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'gateway'}
                aria-controls="operations-panel-gateway"
                id="operations-tab-gateway"
                onClick={() => switchTab('gateway')}
                className={`inline-flex items-center justify-center gap-2 px-3 min-h-11 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'gateway' ? 'border-mc-accent text-mc-text' : 'border-transparent text-mc-text-secondary hover:text-mc-text'}`}
              >
                <Cpu className="h-4 w-4" />
                <span>Gateway</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'agents'}
                aria-controls="operations-panel-agents"
                id="operations-tab-agents"
                onClick={() => switchTab('agents')}
                className={`inline-flex items-center justify-center gap-2 px-3 min-h-11 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'agents' ? 'border-mc-accent text-mc-text' : 'border-transparent text-mc-text-secondary hover:text-mc-text'}`}
              >
                <Bot className="h-4 w-4" />
                <span>Agents</span>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'humans'}
                aria-controls="operations-panel-humans"
                id="operations-tab-humans"
                onClick={() => switchTab('humans')}
                className={`inline-flex items-center justify-center gap-2 px-3 min-h-11 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'humans' ? 'border-mc-accent text-mc-text' : 'border-transparent text-mc-text-secondary hover:text-mc-text'}`}
              >
                <Mail className="h-4 w-4" />
                <span>Humans</span>
              </button>
          </div>

        </section>

        {activeTab === 'system' && (
          <section
            id="operations-panel-system"
            role="tabpanel"
            aria-labelledby="operations-tab-system"
            className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden"
          >
            <SystemPanel embedded />
          </section>
        )}

        {activeTab === 'gateway' && (
          <section
            id="operations-panel-gateway"
            role="tabpanel"
            aria-labelledby="operations-tab-gateway"
            className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden"
          >
            <OpenClawPanel embedded focusArea="gateway" />
          </section>
        )}

        {activeTab === 'agents' && (
          <section
            id="operations-panel-agents"
            role="tabpanel"
            aria-labelledby="operations-tab-agents"
            className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden"
          >
            <OpenClawPanel embedded focusArea="agents" />
          </section>
        )}

        {activeTab === 'humans' && (
          <section
            id="operations-panel-humans"
            role="tabpanel"
            aria-labelledby="operations-tab-humans"
          >
            <HumanManagementPanel />
          </section>
        )}
      </main>
    </div>
  );
}
