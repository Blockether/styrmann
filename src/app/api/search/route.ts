import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SearchResult {
  id: string;
  entity_type: string;
  title: string;
  snippet: string;
  rank: number;
}

const VALID_ENTITY_TYPES = new Set(['memories', 'org_tickets', 'knowledge_articles', 'commits']);

// GET /api/search - Unified FTS5 search across all entity types
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const entityTypesParam = searchParams.get('entity_types') || 'memories,org_tickets,knowledge_articles,commits';
    const organization_id = searchParams.get('organization_id');
    const workspace_id = searchParams.get('workspace_id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    if (!q || !q.trim()) {
      return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
    }

    // Escape FTS5 special chars — wrap in double-quotes
    const safeQuery = q.replace(/"/g, ' ').trim();
    if (!safeQuery) {
      return NextResponse.json({ results: [], total: 0 });
    }
    const ftsQuery = `"${safeQuery}"`;

    const entityTypes = entityTypesParam.split(',').filter(t => VALID_ENTITY_TYPES.has(t.trim()));
    if (entityTypes.length === 0) {
      return NextResponse.json({ results: [], total: 0 });
    }

    const db = getDb();
    const allResults: SearchResult[] = [];

    for (const entityType of entityTypes) {
      try {
        const results = searchEntityType(db, entityType.trim(), ftsQuery, organization_id, workspace_id);
        allResults.push(...results);
      } catch {
        // FTS table might not exist or query might fail — skip silently
        console.warn(`FTS search failed for entity type: ${entityType}`);
      }
    }

    // Sort by rank (bm25 returns negative values — more negative = better match)
    allResults.sort((a, b) => a.rank - b.rank);

    const total = allResults.length;
    const paged = allResults.slice(offset, offset + limit);

    return NextResponse.json({ results: paged, total });
  } catch (error) {
    console.error('Failed to execute search:', error);
    return NextResponse.json({ error: 'Failed to execute search' }, { status: 500 });
  }
}

function searchEntityType(
  db: ReturnType<typeof getDb>,
  entityType: string,
  ftsQuery: string,
  organization_id: string | null,
  workspace_id: string | null,
): SearchResult[] {
  switch (entityType) {
    case 'memories': {
      let query = `
        SELECT m.id, 'memory' as entity_type, m.title,
          snippet(memories_fts, 0, '<b>', '</b>', '...', 10) as snippet,
          bm25(memories_fts) as rank
        FROM memories_fts
        JOIN memories m ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];
      if (organization_id) { query += ' AND m.organization_id = ?'; params.push(organization_id); }
      if (workspace_id) { query += ' AND m.workspace_id = ?'; params.push(workspace_id); }
      return db.prepare(query).all(...params) as SearchResult[];
    }

    case 'org_tickets': {
      let query = `
        SELECT t.id, 'org_ticket' as entity_type, t.title,
          snippet(org_tickets_fts, 0, '<b>', '</b>', '...', 10) as snippet,
          bm25(org_tickets_fts) as rank
        FROM org_tickets_fts
        JOIN org_tickets t ON t.rowid = org_tickets_fts.rowid
        WHERE org_tickets_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];
      if (organization_id) { query += ' AND t.organization_id = ?'; params.push(organization_id); }
      return db.prepare(query).all(...params) as SearchResult[];
    }

    case 'knowledge_articles': {
      let query = `
        SELECT ka.id, 'knowledge_article' as entity_type, ka.title,
          snippet(knowledge_articles_fts, 0, '<b>', '</b>', '...', 10) as snippet,
          bm25(knowledge_articles_fts) as rank
        FROM knowledge_articles_fts
        JOIN knowledge_articles ka ON ka.rowid = knowledge_articles_fts.rowid
        WHERE knowledge_articles_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];
      if (organization_id) { query += ' AND ka.organization_id = ?'; params.push(organization_id); }
      if (workspace_id) { query += ' AND ka.workspace_id = ?'; params.push(workspace_id); }
      return db.prepare(query).all(...params) as SearchResult[];
    }

    case 'commits': {
      let query = `
        SELECT c.id, 'commit' as entity_type, c.message as title,
          snippet(commits_fts, 0, '<b>', '</b>', '...', 10) as snippet,
          bm25(commits_fts) as rank
        FROM commits_fts
        JOIN commits c ON c.rowid = commits_fts.rowid
        WHERE commits_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];
      if (workspace_id) { query += ' AND c.workspace_id = ?'; params.push(workspace_id); }
      return db.prepare(query).all(...params) as SearchResult[];
    }

    default:
      return [];
  }
}
