/**
 * Learner Module
 *
 * Captures lessons learned from stage transitions and injects
 * relevant knowledge into agent dispatch messages.
 */

import { queryOne, queryAll, run } from '@/lib/db';
import { getMissionControlUrl } from '@/lib/config';
import { getOpenClawClient } from '@/lib/openclaw/client';
import type { KnowledgeEntry, TaskRole, OpenClawSession } from '@/lib/types';

/**
 * Notify the Learner agent about a stage transition.
 * The learner captures what happened and writes to the knowledge base.
 */
export async function notifyLearner(
  taskId: string,
  event: {
    previousStatus: string;
    newStatus: string;
    passed: boolean;
    failReason?: string;
    context?: string;
  }
): Promise<void> {
  // Find learner role assignment for this task
  const learnerRole = queryOne<TaskRole & { agent_name: string; session_key_prefix?: string }>(
    `SELECT tr.*, a.name as agent_name, a.session_key_prefix
     FROM task_roles tr
     JOIN agents a ON tr.agent_id = a.id
     WHERE tr.task_id = ? AND tr.role = 'learner'`,
    [taskId]
  );

  if (!learnerRole) return; // No learner assigned, skip

  const task = queryOne<{ title: string; workspace_id: string }>(
    'SELECT title, workspace_id FROM tasks WHERE id = ?',
    [taskId]
  );
  if (!task) return;

  // Find or create a session for the learner
  let session = queryOne<OpenClawSession>(
    'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
    [learnerRole.agent_id, 'active']
  );

  const missionControlUrl = getMissionControlUrl();

  const learningMessage = `**STAGE TRANSITION — LEARNING CAPTURE**

**Task:** ${task.title} (${taskId})
**Transition:** ${event.previousStatus} → ${event.newStatus}
**Result:** ${event.passed ? 'PASSED' : 'FAILED'}
${event.failReason ? `**Failure Reason:** ${event.failReason}` : ''}
${event.context ? `**Context:** ${event.context}` : ''}

**Your job:** Analyze this transition and capture any lessons learned.
When done, call this API to save your findings:

POST ${missionControlUrl}/api/workspaces/${task.workspace_id}/knowledge
Body: {
  "task_id": "${taskId}",
  "category": "failure" | "fix" | "pattern" | "checklist",
  "title": "Brief lesson title",
  "content": "Detailed description of what was learned",
  "tags": ["relevant", "tags"],
  "confidence": 0.8
}

Focus on:
- What went wrong (if failed)
- What pattern caused the issue
- How to prevent it in the future
- Any checklist items that should be added`;

  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    if (!session) {
      // Create session for learner if needed
      const { v4: uuidv4 } = await import('uuid');
      const sessionId = uuidv4();
      const openclawSessionId = `mission-control-${learnerRole.agent_name.toLowerCase().replace(/\s+/g, '-')}`;

      run(
        `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [sessionId, learnerRole.agent_id, openclawSessionId, 'mission-control', 'active']
      );

      session = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [sessionId]);
    }

    if (session) {
      const prefix = learnerRole.session_key_prefix || 'agent:main:';
      const sessionKey = `${prefix}${session.openclaw_session_id}`;
      await client.call('chat.send', {
        sessionKey,
        message: learningMessage,
        idempotencyKey: `learner-${taskId}-${event.newStatus}-${Date.now()}`
      });
      console.log(`[Learner] Notified ${learnerRole.agent_name} about ${event.previousStatus}→${event.newStatus}`);
    }
  } catch (err) {
    // Learner notification is best-effort — don't fail the transition
    console.error('[Learner] Failed to notify learner:', (err as Error).message);
  }
}

/**
 * Get relevant knowledge entries to inject into a builder's dispatch context.
 * Called before dispatching to the builder agent.
 *
 * Uses task title keywords to prioritize entries with matching terms.
 * Falls back to confidence-based ordering when no keyword matches exist.
 */
export function getRelevantKnowledge(workspaceId: string, taskTitle: string, limit = 5): KnowledgeEntry[] {
  // Extract significant words from task title (skip common words)
  const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'it', 'its', 'this', 'that', 'these', 'those', 'as', 'if', 'when', 'than', 'so', 'no', 'not', 'only', 'own', 'same', 'into', 'also', 'just', 'now', 'here', 'there', 'where', 'which', 'who', 'what', 'how', 'why', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'up', 'down', 'out', 'over', 'under', 'again', 'further', 'then', 'once']);

  const keywords = taskTitle
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5); // Limit to 5 keywords

  // If no keywords, fall back to confidence-based ordering
  if (keywords.length === 0) {
    return getEntriesByConfidence(workspaceId, limit);
  }

  // Build OR conditions for keyword matching
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const kw of keywords) {
    conditions.push(`LOWER(title) LIKE ? OR LOWER(content) LIKE ?`);
    params.push(`%${kw}%`, `%${kw}%`);
  }

  // Query: entries matching any keyword, ordered by confidence
  const matchingEntries = queryAll<KnowledgeEntry & { tags: string }>(
    `SELECT * FROM knowledge_entries
     WHERE workspace_id = ? AND (${conditions.join(' OR ')})
     ORDER BY confidence DESC, created_at DESC
     LIMIT ?`,
    [workspaceId, ...params, limit]
  );

  // If we got enough matches, return them
  if (matchingEntries.length >= limit) {
    return matchingEntries.map(e => ({
      ...e,
      tags: e.tags ? (typeof e.tags === 'string' ? JSON.parse(e.tags) : e.tags) : [],
    }));
  }

  // Otherwise, get all entries and prioritize keyword matches
  const allEntries = queryAll<KnowledgeEntry & { tags: string }>(
    `SELECT * FROM knowledge_entries
     WHERE workspace_id = ?
     ORDER BY confidence DESC, created_at DESC
     LIMIT ?`,
    [workspaceId, limit * 2] // Fetch extra to allow for re-ranking
  );

  // Re-rank: matching entries first, then others by confidence
  const matchSet = new Set(matchingEntries.map(e => e.id));
  const ranked = [
    ...matchingEntries,
    ...allEntries.filter(e => !matchSet.has(e.id))
  ].slice(0, limit);

  return ranked.map(e => ({
    ...e,
    tags: e.tags ? (typeof e.tags === 'string' ? JSON.parse(e.tags) : e.tags) : [],
  }));
}

/**
 * Fallback: get entries by confidence score only
 */
function getEntriesByConfidence(workspaceId: string, limit: number): KnowledgeEntry[] {
  const entries = queryAll<KnowledgeEntry & { tags: string }>(
    `SELECT * FROM knowledge_entries
     WHERE workspace_id = ?
     ORDER BY confidence DESC, created_at DESC
     LIMIT ?`,
    [workspaceId, limit]
  );

  return entries.map(e => ({
    ...e,
    tags: e.tags ? (typeof e.tags === 'string' ? JSON.parse(e.tags) : e.tags) : [],
  }));
}

/**
 * Format knowledge entries for injection into a dispatch message
 */
export function formatKnowledgeForDispatch(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '';

  const items = entries.map((e, i) =>
    `${i + 1}. **${e.title}** (${e.category}, confidence: ${(e.confidence * 100).toFixed(0)}%)\n   ${e.content}`
  ).join('\n\n');

  return `\n---\n**PREVIOUS LESSONS LEARNED:**\n${items}\n\nKeep these in mind to avoid repeating past mistakes.\n`;
}
