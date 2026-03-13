import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Agent } from '@/lib/types';

type SessionRow = {
  id: string;
  openclaw_session_id: string;
  agent_id: string | null;
  task_id: string | null;
  status: string | null;
  ended_at: string | null;
};

function maybeStandbyAgent(agentId: string, at: string) {
  const active = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM openclaw_sessions WHERE agent_id = ? AND status = ? AND ended_at IS NULL',
    [agentId, 'active'],
  );
  if ((active?.count || 0) > 0) return;

  run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', at, agentId]);
  const updatedAgent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (updatedAgent) {
    broadcast({ type: 'agent_updated', payload: updatedAgent });
  }
}

export function finalizeSessionById(sessionId: string, status: 'completed' | 'interrupted', endedAt?: string): boolean {
  const session = queryOne<SessionRow>(
    'SELECT id, openclaw_session_id, agent_id, task_id, status, ended_at FROM openclaw_sessions WHERE openclaw_session_id = ? LIMIT 1',
    [sessionId],
  );
  if (!session) return false;

  const at = endedAt || new Date().toISOString();
  run(
    'UPDATE openclaw_sessions SET status = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?',
    [status, at, at, session.id],
  );
  if (session.agent_id) {
    maybeStandbyAgent(session.agent_id, at);
  }
  return true;
}

export function finalizeOtherActiveSessionsForTask(taskId: string, excludeAgentId?: string | null, status: 'completed' | 'interrupted' = 'interrupted'): string[] {
  const sessions = queryAll<SessionRow>(
    `SELECT id, openclaw_session_id, agent_id, task_id, status, ended_at
     FROM openclaw_sessions
     WHERE task_id = ? AND status = 'active' AND ended_at IS NULL${excludeAgentId ? ' AND (agent_id IS NULL OR agent_id != ?)' : ''}`,
    excludeAgentId ? [taskId, excludeAgentId] : [taskId],
  );
  if (sessions.length === 0) return [];

  const at = new Date().toISOString();
  for (const session of sessions) {
    run(
      'UPDATE openclaw_sessions SET status = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?',
      [status, at, at, session.id],
    );
    if (session.agent_id) {
      maybeStandbyAgent(session.agent_id, at);
    }
  }
  return sessions.map((session) => session.openclaw_session_id);
}
