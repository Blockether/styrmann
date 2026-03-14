import { beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '@/lib/db/test-helpers';

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

vi.mock('@/lib/llm', () => ({
  isLlmAvailable: vi.fn(() => false),
  llmInfer: vi.fn(async () => null),
}));

vi.mock('@/lib/events', () => ({
  broadcast: vi.fn(),
}));

import { getDb } from '@/lib/db';
import { isLlmAvailable, llmInfer } from '@/lib/llm';
import { synthesizeKnowledge } from '@/lib/knowledge-synthesis';

describe('synthesizeKnowledge', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
    vi.mocked(getDb).mockReturnValue(testDb);
  });

  it('returns success with zero articles when LLM unavailable', async () => {
    vi.mocked(isLlmAvailable).mockReturnValue(false);

    const orgId = uuidv4();
    testDb.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Test Org', `test-org-${orgId.slice(0, 8)}`);

    for (let i = 0; i < 5; i += 1) {
      testDb
        .prepare("INSERT INTO memories (id, organization_id, memory_type, title, body) VALUES (?, ?, 'fact', ?, ?)")
        .run(uuidv4(), orgId, `Fact ${i}`, `Body ${i}`);
    }

    const result = await synthesizeKnowledge(orgId);

    expect(result.success).toBe(true);
    expect(result.llm_used).toBe(false);
    expect(result.articles_created).toBe(0);
    expect(result.memories_processed).toBe(5);
  });

  it('returns error for non-existent organization', async () => {
    const result = await synthesizeKnowledge(uuidv4());
    expect(result.success).toBe(false);
    expect(result.error).toBe('Organization not found');
  });

  it('skips synthesis when fewer memories than minMemories', async () => {
    const orgId = uuidv4();
    testDb.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Test Org', `test-org-${orgId.slice(0, 8)}`);
    testDb.prepare("INSERT INTO memories (id, organization_id, memory_type, title) VALUES (?, ?, 'fact', ?)").run(uuidv4(), orgId, 'Only Memory');

    const result = await synthesizeKnowledge(orgId, { minMemories: 5 });

    expect(result.success).toBe(true);
    expect(result.articles_created).toBe(0);
    expect(result.memories_processed).toBe(1);
    expect(result.llm_used).toBe(false);
  });

  it('creates article and derived_from links when LLM succeeds', async () => {
    vi.mocked(isLlmAvailable).mockReturnValue(true);
    vi.mocked(llmInfer).mockResolvedValue(
      JSON.stringify({
        title: 'Repository Operations Learnings',
        summary: 'This captures repeatable operational patterns.',
        body: 'Use deterministic scripts, preserve fallback behavior, and link generated knowledge to raw memories.',
      }),
    );

    const orgId = uuidv4();
    testDb.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Test Org', `test-org-${orgId.slice(0, 8)}`);

    const memoryIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const memoryId = uuidv4();
      memoryIds.push(memoryId);
      testDb
        .prepare("INSERT INTO memories (id, organization_id, memory_type, title, body) VALUES (?, ?, 'decision', ?, ?)")
        .run(memoryId, orgId, `Decision ${i}`, `Detail ${i}`);
    }

    const result = await synthesizeKnowledge(orgId, { maxMemoriesPerArticle: 20 });

    expect(result.success).toBe(true);
    expect(result.llm_used).toBe(true);
    expect(result.articles_created).toBe(1);

    const article = testDb.prepare('SELECT * FROM knowledge_articles WHERE organization_id = ? LIMIT 1').get(orgId) as {
      id: string;
      title: string;
      status: string;
      source_memory_ids: string;
    } | null;

    expect(article).not.toBeNull();
    expect(article?.title).toBe('Repository Operations Learnings');
    expect(article?.status).toBe('published');
    expect(JSON.parse(article?.source_memory_ids || '[]')).toHaveLength(3);

    const linkCount = testDb.prepare(
      "SELECT COUNT(*) as count FROM entity_links WHERE from_entity_type = 'knowledge_article' AND to_entity_type = 'memory' AND link_type = 'derived_from'",
    ).get() as { count: number };

    expect(linkCount.count).toBe(memoryIds.length);
  });
});
