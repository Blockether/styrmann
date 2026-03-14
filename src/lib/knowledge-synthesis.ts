import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { isLlmAvailable, llmInfer } from '@/lib/llm';

export interface SynthesisOptions {
  workspaceId?: string;
  minMemories?: number;
  maxMemoriesPerArticle?: number;
  forceRefresh?: boolean;
}

export interface SynthesisResult {
  success: boolean;
  articles_created: number;
  articles_updated: number;
  memories_processed: number;
  llm_used: boolean;
  error?: string;
}

type OrganizationRow = {
  id: string;
  name: string;
};

type MemoryRow = {
  id: string;
  memory_type: string;
  title: string;
  summary?: string | null;
  body?: string | null;
};

type SynthesizedArticle = {
  title: string;
  summary: string;
  body: string;
};

function groupMemoriesByRelevance(memories: MemoryRow[], maxPerGroup: number): MemoryRow[][] {
  const groups: MemoryRow[][] = [];
  for (let i = 0; i < memories.length; i += maxPerGroup) {
    const group = memories.slice(i, i + maxPerGroup);
    if (group.length > 0) {
      groups.push(group);
    }
  }
  return groups;
}

function fallbackArticle(result: string, groupLength: number): SynthesizedArticle {
  return {
    title: `Knowledge from ${groupLength} memories (${new Date().toLocaleDateString()})`,
    summary: result.slice(0, 200),
    body: result,
  };
}

export async function synthesizeKnowledge(
  organizationId: string,
  options: SynthesisOptions = {},
): Promise<SynthesisResult> {
  const {
    workspaceId,
    minMemories = 3,
    maxMemoriesPerArticle = 20,
    forceRefresh = false,
  } = options;

  const db = getDb();

  const org = db
    .prepare('SELECT id, name FROM organizations WHERE id = ? LIMIT 1')
    .get(organizationId) as OrganizationRow | undefined;

  if (!org) {
    return {
      success: false,
      articles_created: 0,
      articles_updated: 0,
      memories_processed: 0,
      llm_used: false,
      error: 'Organization not found',
    };
  }

  let memoryQuery = "SELECT * FROM memories WHERE organization_id = ? AND status != 'closed'";
  const memoryParams: unknown[] = [organizationId];

  if (workspaceId) {
    memoryQuery += ' AND workspace_id = ?';
    memoryParams.push(workspaceId);
  }

  memoryQuery += ' ORDER BY created_at DESC LIMIT ?';
  memoryParams.push(maxMemoriesPerArticle * 5);

  const memories = db.prepare(memoryQuery).all(...memoryParams) as MemoryRow[];

  if (memories.length < minMemories) {
    return {
      success: true,
      articles_created: 0,
      articles_updated: 0,
      memories_processed: memories.length,
      llm_used: false,
    };
  }

  if (!isLlmAvailable()) {
    return {
      success: true,
      articles_created: 0,
      articles_updated: 0,
      memories_processed: memories.length,
      llm_used: false,
    };
  }

  const memoryGroups = groupMemoriesByRelevance(memories, maxMemoriesPerArticle);
  let articlesCreated = 0;

  for (const group of memoryGroups) {
    const hashInput = group
      .map((memory) => `${memory.id}:${memory.summary || memory.title}`)
      .sort()
      .join('|');
    const promptHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    if (!forceRefresh) {
      const existing = db
        .prepare(
          `SELECT id FROM knowledge_articles
           WHERE organization_id = ?
             AND synthesis_prompt_hash = ?
             AND status NOT IN ('stale', 'archived')
           LIMIT 1`,
        )
        .get(organizationId, promptHash) as { id: string } | undefined;

      if (existing) {
        continue;
      }
    }

    const memoryTexts = group
      .map((memory) => `[${memory.memory_type.toUpperCase()}] ${memory.title}\n${memory.summary || memory.body || ''}`)
      .join('\n\n');

    const systemPrompt = `You are a knowledge synthesizer. Given a set of raw development memories (facts, decisions, observations, errors, notes), synthesize them into a clear, actionable knowledge article.

The article should:
- Have a clear, descriptive title
- Start with a concise summary (1-2 sentences)
- Provide detailed body content with insights from the memories
- Be written in plain text (no markdown headers, no bullet lists)
- Focus on what was learned and what decisions were made
- Be useful for future development reference

Return the result as JSON with:
{
  "title": "...",
  "summary": "...",
  "body": "..."
}`;

    const userPrompt = `Organization: ${org.name}
Memories to synthesize (${group.length} items):

${memoryTexts}

Synthesize these memories into a knowledge article.`;

    try {
      const llmResult = await llmInfer(systemPrompt, userPrompt);
      if (!llmResult) {
        continue;
      }

      let article: SynthesizedArticle;
      try {
        const parsed = JSON.parse(llmResult) as Partial<SynthesizedArticle>;
        article = {
          title: parsed.title || '',
          summary: parsed.summary || '',
          body: parsed.body || '',
        };
      } catch {
        article = fallbackArticle(llmResult, group.length);
      }

      if (!article.title || !article.body) {
        continue;
      }

      const articleId = uuidv4();
      const sourceMemoryIds = JSON.stringify(group.map((memory) => memory.id));

      if (workspaceId) {
        db.prepare(
          `UPDATE knowledge_articles
           SET status = 'archived', updated_at = datetime('now')
           WHERE organization_id = ? AND workspace_id = ? AND status = 'stale'`,
        ).run(organizationId, workspaceId);
      } else {
        db.prepare(
          `UPDATE knowledge_articles
           SET status = 'archived', updated_at = datetime('now')
           WHERE organization_id = ? AND status = 'stale'`,
        ).run(organizationId);
      }

      db.prepare(
        `INSERT INTO knowledge_articles (
          id,
          organization_id,
          workspace_id,
          title,
          summary,
          body,
          synthesis_model,
          synthesis_prompt_hash,
          source_memory_ids,
          status,
          version,
          created_at,
          updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, datetime('now'), datetime('now')
        )`,
      ).run(
        articleId,
        organizationId,
        workspaceId || null,
        article.title,
        article.summary,
        article.body,
        'llm',
        promptHash,
        sourceMemoryIds,
      );

      for (const memory of group) {
        db.prepare(
          `INSERT OR IGNORE INTO entity_links (
            id,
            from_entity_type,
            from_entity_id,
            to_entity_type,
            to_entity_id,
            link_type,
            created_at
          ) VALUES (?, 'knowledge_article', ?, 'memory', ?, 'derived_from', datetime('now'))`,
        ).run(uuidv4(), articleId, memory.id);
      }

      articlesCreated += 1;

      broadcast({
        type: 'knowledge_synthesized',
        payload: { id: articleId },
      });
    } catch (error) {
      console.error('[KnowledgeSynthesis] Failed for group:', error);
    }
  }

  return {
    success: true,
    articles_created: articlesCreated,
    articles_updated: 0,
    memories_processed: memories.length,
    llm_used: true,
  };
}
