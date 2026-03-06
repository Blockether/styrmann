import { v4 as uuidv4 } from 'uuid';
import { queryAll, run, transaction } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { readOpenClawConfig, resolveAgents, hasConfigChanged } from '@/lib/openclaw/config';
import type { Agent } from '@/lib/types';

interface GatewayAgent {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

let initialSyncDone = false;

export function ensureSynced(): void {
  if (!initialSyncDone || hasConfigChanged()) {
    initialSyncDone = true;
    syncAgentsFromConfig();
  }
}

export function syncAgentsFromConfig(): { synced: string[]; updated: string[]; removed: string[] } {
  const results = { synced: [] as string[], updated: [] as string[], removed: [] as string[] };

  const config = readOpenClawConfig();
  if (!config) return results;

  const resolved = resolveAgents(config);
  if (resolved.length === 0) return results;

  const existingSynced = queryAll<Agent>(
    `SELECT * FROM agents WHERE source IN ('synced', 'gateway') AND gateway_agent_id IS NOT NULL`
  );
  const existingByGatewayId = new Map<string, Agent>();
  for (const a of existingSynced) {
    if (a.gateway_agent_id) {
      existingByGatewayId.set(a.gateway_agent_id, a);
    }
  }

  transaction(() => {
    const now = new Date().toISOString();
    const syncedGatewayIds = new Set<string>();

    for (const agent of resolved) {
      syncedGatewayIds.add(agent.id);
      const existing = existingByGatewayId.get(agent.id);

      if (existing) {
        run(
          `UPDATE agents SET
            name = ?, role = ?, model = ?,
            soul_md = NULL, user_md = NULL, agents_md = NULL,
            description = ?,
            agent_dir = ?, agent_workspace_path = ?,
            source = 'synced', status = 'standby',
            session_key_prefix = ?, updated_at = ?
          WHERE id = ?`,
          [
            agent.name,
            agent.role,
            agent.model,
            agent.systemMd ? agent.role : existing.description,
            agent.agentDir,
            agent.workspacePath,
            `agent:${agent.id}:`,
            now,
            existing.id,
          ]
        );
        results.updated.push(agent.id);
      } else {
        const id = uuidv4();
        run(
          `INSERT INTO agents (
            id, name, role, description,
            workspace_id, soul_md, user_md, agents_md, model,
            source, gateway_agent_id, session_key_prefix,
            agent_dir, agent_workspace_path, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            agent.name,
            agent.role,
            agent.systemMd ? agent.role : `Synced from OpenClaw (${agent.id})`,
            'default',
            agent.model,
            'synced',
            agent.id,
            `agent:${agent.id}:`,
            agent.agentDir,
            agent.workspacePath,
            now,
            now,
          ]
        );

        run(
          `INSERT INTO events (id, type, agent_id, message, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [uuidv4(), 'agent_joined', id, `${agent.name} synced from OpenClaw Gateway`, now]
        );

        results.synced.push(agent.id);
      }
    }

    for (const [gatewayId, existing] of Array.from(existingByGatewayId.entries())) {
      if (!syncedGatewayIds.has(gatewayId)) {
        run('DELETE FROM openclaw_sessions WHERE agent_id = ?', [existing.id]);
        run('DELETE FROM events WHERE agent_id = ?', [existing.id]);
        run('UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id = ?', [existing.id]);
        run('DELETE FROM agents WHERE id = ?', [existing.id]);
        results.removed.push(gatewayId);
      }
    }
  });

  return results;
}

export async function syncAgentsWithRpcCheck(): Promise<{ synced: string[]; updated: string[]; removed: string[] }> {
  const config = readOpenClawConfig();
  if (!config) return { synced: [], updated: [], removed: [] };

  const resolved = resolveAgents(config);
  if (resolved.length === 0) return { synced: [], updated: [], removed: [] };

  let liveAgentIds = new Set<string>();
  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }
    const gatewayAgents = (await client.listAgents()) as GatewayAgent[];
    liveAgentIds = new Set(
      gatewayAgents.map((a) => a.id || a.name || '').filter(Boolean)
    );
  } catch {
    liveAgentIds = new Set(resolved.map((a) => a.id));
  }

  return syncAgentsFromConfig();
}
