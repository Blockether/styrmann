import { createHash } from 'crypto';
import { createLogger } from './logger';
import { mcFetch, mcBroadcast } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('logs');

interface OpenClawSessionInfo {
  id: string;
  agent_id?: string;
  openclaw_session_id: string;
  task_id?: string | null;
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
  gateway_agent_id?: string;
}

// ── Auth/provider failure detection ──────────────────────────────────
// Patterns that indicate provider auth failures or config issues in agent logs.
// When detected, an activity is posted on the task so humans can see why an agent stalled.
const AUTH_FAILURE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(401|403)\b.*\b(unauthorized|forbidden|auth|api[_\s-]?key|token)\b/i, label: 'HTTP auth rejection' },
  { pattern: /\bapi[_\s-]?key\b.*(missing|invalid|expired|not\s+found|not\s+set)/i, label: 'API key misconfigured' },
  { pattern: /\b(OPENAI|ANTHROPIC|GOOGLE|AZURE|DEEPSEEK|GLM|MISTRAL)[_\s-]?API[_\s-]?KEY\b.*(missing|invalid|not\s+set|not\s+found)/i, label: 'Provider API key missing' },
  { pattern: /\brate\s*limit(ed)?\b/i, label: 'Rate limited' },
  { pattern: /\bquota\s*(exceeded|exhausted|limit)\b/i, label: 'Quota exhausted' },
  { pattern: /\bmodel\s+(not\s+found|unavailable|does\s+not\s+exist)\b/i, label: 'Model unavailable' },
  { pattern: /\btimeout\b.*(provider|model|api|gateway|request)/i, label: 'Provider timeout' },
  { pattern: /\b(provider|gateway)\b.*(error|failed|unavailable|unreachable)/i, label: 'Provider error' },
  { pattern: /\ball\s+(fallback|provider|model)s?\s+(failed|exhausted|unavailable)/i, label: 'All providers failed' },
];

// Cooldown: don't spam activities for the same session
const authFailureReportedSessions = new Map<string, number>();
const AUTH_FAILURE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function detectAuthFailures(entries: Array<{ role: string; content: string }>): { detected: boolean; labels: string[] } {
  const labels = new Set<string>();
  for (const entry of entries) {
    if (entry.role !== 'assistant' && entry.role !== 'system') continue;
    for (const { pattern, label } of AUTH_FAILURE_PATTERNS) {
      if (pattern.test(entry.content)) {
        labels.add(label);
      }
    }
  }
  return { detected: labels.size > 0, labels: Array.from(labels) };
}

async function reportAuthFailure(
  sessionKey: string,
  taskId: string,
  agentId: string | null,
  agentName: string | undefined,
  labels: string[],
): Promise<void> {
  const now = Date.now();
  const lastReported = authFailureReportedSessions.get(sessionKey);
  if (lastReported && now - lastReported < AUTH_FAILURE_COOLDOWN_MS) return;
  authFailureReportedSessions.set(sessionKey, now);

  const agentLabel = agentName || agentId || 'unknown agent';
  const issueList = labels.join(', ');
  const message = `[Provider Alert] Detected provider/auth failures in ${agentLabel} session: ${issueList}. Agent may be stalled due to credential or provider issues.`;

  try {
    await mcFetch(`/api/tasks/${taskId}/activities`, {
      method: 'POST',
      body: JSON.stringify({
        activity_type: 'status_changed',
        agent_id: agentId,
        message,
        metadata: JSON.stringify({
          workflow_step: 'in_progress',
          decision_event: true,
          provider_alert: true,
          failure_labels: labels,
          session_key: sessionKey,
        }),
      }),
    });
    log.warn(`Reported auth failure for task ${taskId}: ${issueList}`);
  } catch (err) {
    log.error(`Failed to report auth failure activity: ${String(err)}`);
  }
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

          const workspaceId = 'default';

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

            // 5b. Detect auth/provider failures in new entries
            if (stored > 0 && session.task_id) {
              const { detected, labels } = detectAuthFailures(newEntries);
              if (detected) {
                await reportAuthFailure(
                  sessionKey,
                  session.task_id,
                  agent?.id || session.agent_id || null,
                  agent?.name,
                  labels,
                );
              }
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
        // Prune stale auth failure cooldowns
        const pruneThreshold = Date.now() - AUTH_FAILURE_COOLDOWN_MS * 2;
        for (const [key, ts] of authFailureReportedSessions) {
          if (ts < pruneThreshold) authFailureReportedSessions.delete(key);
        }
      }
    } catch (err) {
      log.error('Log poller tick failed:', err);
    }
  }

  async function cleanupStaleLogs() {
    try {
      const res = await mcFetch('/api/logs?days=60', { method: 'DELETE' });
      if (res.ok) {
        const result = await res.json();
        if (result.deleted > 0) {
          log.info(`Cleaned up ${result.deleted} stale log entries (>60 days)`);
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
