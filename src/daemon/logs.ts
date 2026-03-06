import { createHash } from 'crypto';
import { createLogger } from './logger';
import { mcFetch, mcBroadcast } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('logs');

interface OpenClawSessionInfo {
  id: string;
  agent_id?: string;
  openclaw_session_id: string;
  status: string;
}

interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface AgentInfo {
  id: string;
  name: string;
  workspace_id: string;
  gateway_agent_id?: string;
}

// Track which hashes we've already stored, to avoid re-POSTing
const knownHashes = new Set<string>();
const MAX_KNOWN_HASHES = 50_000;

function contentHash(sessionId: string, role: string, content: string, index: number): string {
  return createHash('sha256')
    .update(`${sessionId}:${role}:${index}:${content}`)
    .digest('hex')
    .slice(0, 32);
}

function pruneKnownHashes() {
  if (knownHashes.size > MAX_KNOWN_HASHES) {
    // Drop oldest half (Set insertion order)
    const entries = Array.from(knownHashes);
    const dropCount = Math.floor(entries.length / 2);
    for (let i = 0; i < dropCount; i++) {
      knownHashes.delete(entries[i]);
    }
    log.info(`Pruned known hashes: ${dropCount} removed, ${knownHashes.size} remaining`);
  }
}

export function startLogPoller(config: DaemonConfig, stats: DaemonStats): () => void {
  let tickCount = 0;

  async function tick() {
    try {
      // 1. Get all agents to map gateway_agent_id -> agent info
      const agentsRes = await mcFetch('/api/agents');
      if (!agentsRes.ok) {
        log.warn(`Failed to fetch agents: ${agentsRes.status}`);
        return;
      }
      const agents: AgentInfo[] = await agentsRes.json();
      const agentByGatewayId = new Map<string, AgentInfo>();
      for (const agent of agents) {
        if (agent.gateway_agent_id) {
          agentByGatewayId.set(agent.gateway_agent_id, agent);
        }
      }

      // 2. Get active OpenClaw sessions from DB
      const sessionsRes = await mcFetch('/api/openclaw/sessions?status=active');
      if (!sessionsRes.ok) {
        // Might just mean no sessions — not a critical error
        if (sessionsRes.status !== 404) {
          log.warn(`Failed to fetch sessions: ${sessionsRes.status}`);
        }
        return;
      }

      let sessions: OpenClawSessionInfo[];
      try {
        const body = await sessionsRes.json();
        sessions = Array.isArray(body) ? body : (body.sessions || []);
      } catch {
        log.warn('Failed to parse sessions response');
        return;
      }

      if (sessions.length === 0) {
        stats.lastLogPollTick = new Date().toISOString();
        return;
      }

      let totalNewLogs = 0;

      // 3. For each session, fetch history and store new entries
      for (const session of sessions) {
        try {
          // Construct the full session key for chat.history RPC
          const sessionSuffix = session.openclaw_session_id || session.id;
          const agent = session.agent_id
            ? agents.find(a => a.id === session.agent_id)
            : undefined;
          const gatewayAgentId = agent?.gateway_agent_id;
          const sessionKey = gatewayAgentId
            ? `agent:${gatewayAgentId}:${sessionSuffix}`
            : sessionSuffix;
          const historyRes = await mcFetch(`/api/openclaw/sessions/${encodeURIComponent(sessionKey)}/history`);
          if (!historyRes.ok) continue;

          const body = await historyRes.json();
          const messages: HistoryMessage[] = Array.isArray(body) ? body : (body.history || []);
          if (messages.length === 0) continue;

          const workspaceId = agent?.workspace_id || 'default';

          // Build log entries, skipping already-known hashes
          const newEntries: Array<{
            id: string;
            agent_id: string | null;
            openclaw_session_id: string;
            role: string;
            content: string;
            content_hash: string;
            workspace_id: string;
            created_at: string;
          }> = [];

          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (!msg.content || !msg.role) continue;

            const hash = contentHash(sessionKey, msg.role, msg.content, i);
            if (knownHashes.has(hash)) continue;

            const entryId = createHash('sha256')
              .update(`${hash}:${Date.now()}:${Math.random()}`)
              .digest('hex')
              .slice(0, 24);

            newEntries.push({
              id: entryId,
              agent_id: agent?.id || session.agent_id || null,
              openclaw_session_id: sessionSuffix,
              role: msg.role,
              content: msg.content,
              content_hash: hash,
              workspace_id: workspaceId,
              created_at: msg.timestamp || new Date().toISOString(),
            });
          }

          if (newEntries.length === 0) continue;

          // 4. Store via POST to logs API
          const storeRes = await mcFetch('/api/logs/ingest', {
            method: 'POST',
            body: JSON.stringify({ entries: newEntries }),
          });

          if (storeRes.ok) {
            const result = await storeRes.json();
            const stored = result.stored || newEntries.length;
            totalNewLogs += stored;

            // Mark hashes as known
            for (const entry of newEntries) {
              knownHashes.add(entry.content_hash);
            }

            // 5. Broadcast new log entries via SSE
            if (stored > 0) {
              await mcBroadcast({
                type: 'agent_log_added',
                payload: {
                  count: stored,
                  session_id: sessionKey,
                  agent_id: agent?.id || session.agent_id || null,
                  agent_name: agent?.name,
                  workspace_id: workspaceId,
                },
              });
            }
          } else {
            // If 409 conflict, the entries already exist — mark hashes as known
            if (storeRes.status === 409) {
              for (const entry of newEntries) {
                knownHashes.add(entry.content_hash);
              }
            } else {
              log.warn(`Failed to store logs for session ${sessionKey}: ${storeRes.status}`);
            }
          }
        } catch (err) {
          log.error(`Error processing session:`, err);
        }
      }

      stats.lastLogPollTick = new Date().toISOString();
      stats.logEntriesStored = (stats.logEntriesStored || 0) + totalNewLogs;

      if (totalNewLogs > 0) {
        log.info(`Stored ${totalNewLogs} new log entries from ${sessions.length} session(s)`);
      }

      // 6. Cleanup stale logs every 100 ticks (~50 minutes at 30s interval)
      tickCount++;
      if (tickCount % 100 === 0) {
        await cleanupStaleLogs();
        pruneKnownHashes();
      }
    } catch (err) {
      log.error('Log poller tick failed:', err);
    }
  }

  async function cleanupStaleLogs() {
    try {
      const res = await mcFetch('/api/logs?days=30', { method: 'DELETE' });
      if (res.ok) {
        const result = await res.json();
        if (result.deleted > 0) {
          log.info(`Cleaned up ${result.deleted} stale log entries (>30 days)`);
          stats.logEntriesCleaned = (stats.logEntriesCleaned || 0) + result.deleted;
        }
      }
    } catch (err) {
      log.error('Log cleanup failed:', err);
    }
  }

  // Run initial cleanup on startup, then start polling
  cleanupStaleLogs();
  tick();
  const id = setInterval(tick, config.logPollIntervalMs || 30_000);
  return () => clearInterval(id);
}
