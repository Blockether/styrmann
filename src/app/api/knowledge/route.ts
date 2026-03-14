import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { KnowledgeArticle } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/knowledge - List knowledge articles with optional filters and FTS5 search
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organization_id = searchParams.get('organization_id');
    const workspace_id = searchParams.get('workspace_id');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const db = getDb();

    if (search) {
      const safeQuery = search.replace(/"/g, ' ').trim();
      if (!safeQuery) {
        return NextResponse.json([]);
      }

      let query = `
        SELECT ka.*, bm25(knowledge_articles_fts) as rank
        FROM knowledge_articles_fts
        JOIN knowledge_articles ka ON ka.rowid = knowledge_articles_fts.rowid
        WHERE knowledge_articles_fts MATCH ?
      `;
      const params: unknown[] = [`"${safeQuery}"`];

      if (organization_id) {
        query += ' AND ka.organization_id = ?';
        params.push(organization_id);
      }
      if (workspace_id) {
        query += ' AND ka.workspace_id = ?';
        params.push(workspace_id);
      }
      if (status) {
        query += ' AND ka.status = ?';
        params.push(status);
      }

      query += ' ORDER BY rank LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const articles = db.prepare(query).all(...params) as (KnowledgeArticle & { rank: number })[];
      const result = articles.map(a => ({
        ...a,
        source_memory_ids: JSON.parse(a.source_memory_ids || '[]'),
      }));

      return NextResponse.json(result);
    }

    // Standard filtered listing
    let query = 'SELECT * FROM knowledge_articles WHERE 1=1';
    const params: unknown[] = [];

    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(organization_id);
    }
    if (workspace_id) {
      query += ' AND workspace_id = ?';
      params.push(workspace_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const articles = db.prepare(query).all(...params) as KnowledgeArticle[];
    const result = articles.map(a => ({
      ...a,
      source_memory_ids: JSON.parse(a.source_memory_ids || '[]'),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch knowledge articles:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge articles' }, { status: 500 });
  }
}
