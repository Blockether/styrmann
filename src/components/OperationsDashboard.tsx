'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDown, Bot, CheckCircle2, Cpu, RefreshCw, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import { OpenClawPanel } from './OpenClawPanel';
import { SystemPanel } from './SystemPanel';

interface OpenClawStatusSummary {
  connected: boolean;
}

interface DaemonStatsSummary {
  stale: boolean;
}

interface SystemInfoSummary {
  services: {
    web: string;
    daemon: string;
  };
}

interface AgentSummary {
  status?: string;
}

export function OperationsDashboard() {
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [openClawConnected, setOpenClawConnected] = useState<boolean | null>(null);
  const [daemonFresh, setDaemonFresh] = useState<boolean | null>(null);
  const [servicesHealthy, setServicesHealthy] = useState<boolean | null>(null);
  const [workingAgents, setWorkingAgents] = useState<number | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const [openClawRes, daemonRes, systemRes, agentsRes] = await Promise.all([
        fetch('/api/openclaw/status'),
        fetch('/api/daemon/stats'),
        fetch('/api/system/info'),
        fetch('/api/agents'),
      ]);

      if (openClawRes.ok) {
        const data: OpenClawStatusSummary = await openClawRes.json();
        setOpenClawConnected(Boolean(data.connected));
      }

      if (daemonRes.ok) {
        const data: DaemonStatsSummary = await daemonRes.json();
        setDaemonFresh(!data.stale);
      }

      if (systemRes.ok) {
        const data: SystemInfoSummary = await systemRes.json();
        setServicesHealthy(data.services.web === 'active' && data.services.daemon === 'active');
      }

      if (agentsRes.ok) {
        const data: AgentSummary[] = await agentsRes.json();
        const active = Array.isArray(data) ? data.filter((agent) => agent.status === 'working').length : 0;
        setWorkingAgents(active);
      }
    } catch {
      setOpenClawConnected(null);
      setDaemonFresh(null);
      setServicesHealthy(null);
      setWorkingAgents(null);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 30000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  const statusTone = (ok: boolean | null) => {
    if (ok === null) return 'border-mc-border text-mc-text-secondary bg-mc-bg';
    return ok
      ? 'border-green-200 bg-green-50 text-green-700'
      : 'border-red-200 bg-red-50 text-red-700';
  };

  const statusIcon = (ok: boolean | null) => {
    if (ok === null) return <RefreshCw className="w-3.5 h-3.5 animate-spin" />;
    return ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />;
  };

  return (
    <div data-component="src/components/OperationsDashboard" className="min-h-screen bg-mc-bg">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="rounded-xl border border-mc-border bg-mc-bg-secondary p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-mc-text-secondary">Operations</p>
              <h1 className="mt-2 text-2xl font-semibold text-mc-text">System and OpenClaw in one operational flow</h1>
              <p className="mt-2 text-sm text-mc-text-secondary">
                Start with runtime validation, then move into gateway control and agent activity. This keeps incident triage and routine monitoring in one coherent lane.
              </p>
            </div>
            <div className="w-full sm:w-auto grid grid-cols-2 gap-2 sm:gap-3 text-sm">
              <Link href="#system-runtime" className="inline-flex items-center justify-center gap-2 px-3 min-h-11 border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary transition-colors text-mc-text">
                <Activity className="h-4 w-4 text-mc-accent" />
                <span>System</span>
              </Link>
              <Link href="#openclaw" className="inline-flex items-center justify-center gap-2 px-3 min-h-11 border border-mc-border rounded bg-mc-bg hover:bg-mc-bg-tertiary transition-colors text-mc-text">
                <Cpu className="h-4 w-4 text-mc-accent" />
                <span>OpenClaw</span>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm text-mc-text-secondary">
            <div className="flex items-start gap-2 rounded-lg border border-mc-border bg-mc-bg px-3 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-mc-accent" />
              <div>
                <div className="font-medium text-mc-text">1. Validate host and daemon</div>
                <div>Run config checks and inspect process health before deeper diagnostics.</div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-mc-border bg-mc-bg px-3 py-3">
              <Cpu className="mt-0.5 h-4 w-4 text-mc-accent" />
              <div>
                <div className="font-medium text-mc-text">2. Confirm gateway and models</div>
                <div>Verify OpenClaw connectivity, session load, and default model selection.</div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-mc-border bg-mc-bg px-3 py-3">
              <Bot className="mt-0.5 h-4 w-4 text-mc-accent" />
              <div>
                <div className="font-medium text-mc-text">3. Triage agents and logs</div>
                <div>Use occupation, audits, and live logs to resolve issues quickly.</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 text-xs">
            <div className={`inline-flex items-center gap-1.5 px-2.5 min-h-11 rounded-md border ${statusTone(openClawConnected)}`}>
              {statusIcon(openClawConnected)}
              <span className="font-medium">Gateway</span>
              <span className="text-[11px]">{openClawConnected === null ? 'checking' : openClawConnected ? 'connected' : 'down'}</span>
            </div>
            <div className={`inline-flex items-center gap-1.5 px-2.5 min-h-11 rounded-md border ${statusTone(daemonFresh)}`}>
              {statusIcon(daemonFresh)}
              <span className="font-medium">Daemon</span>
              <span className="text-[11px]">{daemonFresh === null ? 'checking' : daemonFresh ? 'fresh' : 'stale'}</span>
            </div>
            <div className={`inline-flex items-center gap-1.5 px-2.5 min-h-11 rounded-md border ${statusTone(servicesHealthy)}`}>
              {statusIcon(servicesHealthy)}
              <span className="font-medium">Services</span>
              <span className="text-[11px]">{servicesHealthy === null ? 'checking' : servicesHealthy ? 'healthy' : 'degraded'}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 min-h-11 rounded-md border border-mc-border text-mc-text bg-mc-bg">
              <Bot className="w-3.5 h-3.5 text-mc-accent" />
              <span className="font-medium">Working Agents</span>
              <span className="text-[11px] font-mono">{loadingSummary || workingAgents === null ? 'checking' : workingAgents}</span>
            </div>
          </div>
        </section>

        <section id="system-runtime" className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden">
          <div className="p-4 border-b border-mc-border bg-mc-bg-secondary flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                <Activity className="w-4 h-4 text-mc-text-secondary" />
                <span>System Runtime</span>
              </div>
              <p className="mt-1 text-sm text-mc-text-secondary">
                Monitor the host, daemon, scheduler, and configuration health before drilling into agent traffic.
              </p>
            </div>
          </div>
          <SystemPanel embedded />
        </section>

        <div className="flex items-center justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-mc-border bg-mc-bg-secondary text-xs text-mc-text-secondary">
            <Wrench className="w-3.5 h-3.5" />
            <span>After runtime checks, continue into OpenClaw control and logs</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </div>
        </div>

        <section id="openclaw" className="rounded-xl border border-mc-border bg-mc-bg overflow-hidden">
          <div className="p-4 border-b border-mc-border bg-mc-bg-secondary flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-mc-text">
                <Cpu className="w-4 h-4 text-mc-text-secondary" />
                <span>OpenClaw Control Plane</span>
              </div>
              <p className="mt-1 text-sm text-mc-text-secondary">
                Track gateway connectivity, active agents, model defaults, security posture, and live session output in one place.
              </p>
            </div>
          </div>
          <OpenClawPanel embedded />
        </section>
      </main>
    </div>
  );
}
