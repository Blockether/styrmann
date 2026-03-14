import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { KnowledgeArticle, Memory } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/knowledge/[id] - Single article with resolved source memories
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const article = db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(id) as KnowledgeArticle | undefined;
    if (!article) {
      return NextResponse.json({ error: 'Knowledge article not found' }, { status: 404 });
    }

    const sourceMemoryIds: string[] = JSON.parse(article.source_memory_ids || '[]');
    let source_memories: Memory[] = [];

    if (sourceMemoryIds.length > 0) {
      const placeholders = sourceMemoryIds.map(() => '?').join(', ');
      source_memories = db.prepare(
        `SELECT * FROM memories WHERE id IN (${placeholders})`
      ).all(...sourceMemoryIds) as Memory[];

      // Parse JSON fields on each memory
      source_memories = source_memories.map(m => ({
        ...m,
        metadata: JSON.parse((m.metadata as string) || '{}') as unknown as string,
        tags: JSON.parse((m.tags as string) || '[]') as unknown as string,
      }));
    }

    const result = {
      ...article,
      source_memory_ids: sourceMemoryIds,
      source_memories,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch knowledge article:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge article' }, { status: 500 });
  }
}

// DELETE /api/knowledge/[id] - Archive article (set status='archived', NOT actual delete)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const existing = db.prepare('SELECT id FROM knowledge_articles WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Knowledge article not found' }, { status: 404 });
    }

    db.prepare("UPDATE knowledge_articles SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);

    return NextResponse.json({ id, status: 'archived' });
  } catch (error) {
    console.error('Failed to archive knowledge article:', error);
    return NextResponse.json({ error: 'Failed to archive knowledge article' }, { status: 500 });
  }
}
