import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('heartbeat');

interface AgentInfo {
  id: string;
  name: string;
  status: string;
  updated_at?: string;
}

interface SessionInfo {
  agent_id?: string;
  status?: string;
}

const STALE_THRESHOLD_MS = Number.parseInt(process.env.MC_AGENT_STALE_THRESHOLD_MS || '3600000', 10);

export function startHeartbeat(config: DaemonConfig, stats: DaemonStats): () => void {
  async function tick() {
    try {
      const [agentsRes, sessionsRes] = await Promise.all([
        mcFetch('/api/agents'),
        mcFetch('/api/openclaw/sessions?session_type=subagent&status=active'),
      ]);

      if (!agentsRes.ok) {
        log.warn(`Failed to fetch agents: ${agentsRes.status}`);
        return;
      }

      if (!sessionsRes.ok) {
        log.warn(`Failed to fetch active sessions: ${sessionsRes.status}`);
        return;
      }

      const agents: AgentInfo[] = await agentsRes.json();
      const activeSessionsRaw = await sessionsRes.json();
      const activeSessions = (Array.isArray(activeSessionsRaw) ? activeSessionsRaw : []) as SessionInfo[];
      const activeSessionAgentIds = new Set(
        activeSessions
          .filter((session) => session.status === 'active' && typeof session.agent_id === 'string')
          .map((session) => session.agent_id as string),
      );
      const working = agents.filter(a => a.status === 'working');
      const standby = agents.filter(a => a.status === 'standby');

      stats.heartbeatCount++;
      stats.lastHeartbeatTick = new Date().toISOString();

      log.info(`Agents: ${working.length} working, ${standby.length} standby, ${agents.length} total`);

      // Detect stale working agents
      const now = Date.now();
      for (const agent of working) {
        if (!agent.updated_at) continue;
        const lastUpdate = new Date(agent.updated_at).getTime();
        if (now - lastUpdate > STALE_THRESHOLD_MS) {
          if (activeSessionAgentIds.has(agent.id)) {
            log.info(`Agent ${agent.name} (${agent.id}) has an active session, skipping stale standby recovery.`);
            continue;
          }
          log.warn(`Agent ${agent.name} (${agent.id}) stale — last update ${Math.round((now - lastUpdate) / 60000)}m ago. Setting standby.`);
          try {
            await mcFetch(`/api/agents/${agent.id}`, {
              method: 'PATCH',
              headers: { 'x-mc-system': 'daemon' },
              body: JSON.stringify({ status: 'standby' }),
            });
            stats.staleRecoveredCount++;
          } catch (err) {
            log.error(`Failed to recover stale agent ${agent.name}:`, err);
          }
        }
      }
    } catch (err) {
      log.error('Heartbeat tick failed:', err);
    }
  }

  // Run immediately then on interval
  tick();
  const id = setInterval(tick, config.heartbeatIntervalMs);
  return () => clearInterval(id);
}
