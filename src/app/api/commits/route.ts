import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateCommitSchema } from '@/lib/validation';
import type { Commit } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/commits - List commits with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace_id = searchParams.get('workspace_id');
    const author_email = searchParams.get('author_email');
    const branch = searchParams.get('branch');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const db = getDb();

    let query = 'SELECT * FROM commits WHERE 1=1';
    const params: unknown[] = [];

    if (workspace_id) {
      query += ' AND workspace_id = ?';
      params.push(workspace_id);
    }
    if (author_email) {
      query += ' AND author_email = ?';
      params.push(author_email);
    }
    if (branch) {
      query += ' AND branch = ?';
      params.push(branch);
    }
    if (from) {
      query += ' AND committed_at >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND committed_at <= ?';
      params.push(to);
    }

    query += ' ORDER BY committed_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const commits = db.prepare(query).all(...params) as Commit[];
    const result = commits.map(c => ({
      ...c,
      files_changed: JSON.parse(c.files_changed || '[]'),
      metadata: JSON.parse(c.metadata || '{}'),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch commits:', error);
    return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 });
  }
}

// POST /api/commits - Ingest commit(s), single or batch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const commits = Array.isArray(body) ? body : [body];

    const db = getDb();
    let ingested_count = 0;
    let skipped_count = 0;
    const linked_tickets: string[] = [];

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO commits (
        id, workspace_id, commit_hash, message, author_name, author_email,
        branch, files_changed, insertions, deletions, committed_at, ingested_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `);

    const ingestTransaction = db.transaction(() => {
      for (const commitData of commits) {
        const parsed = CreateCommitSchema.safeParse(commitData);

        if (!parsed.success) {
          skipped_count++;
          continue;
        }

        const {
          workspace_id,
          commit_hash,
          message,
          author_name,
          author_email,
          branch,
          files_changed,
          insertions,
          deletions,
          committed_at,
          metadata,
        } = parsed.data;

        const id = crypto.randomUUID();

        const result = insertStmt.run(
          id,
          workspace_id,
          commit_hash,
          message,
          author_name ?? null,
          author_email ?? null,
          branch ?? null,
          JSON.stringify(files_changed),
          insertions,
          deletions,
          committed_at,
          JSON.stringify(metadata),
        );

        if (result.changes > 0) {
          ingested_count++;

          // Parse commit message for ticket references
          const refs = message.match(/#(\d+)|([A-Z]+-\d+)/g) || [];
          linked_tickets.push(...refs);
        } else {
          skipped_count++;
        }
      }
    });

    ingestTransaction();

    if (ingested_count > 0) {
      broadcast({
        type: 'commit_ingested',
        payload: { ingested_count, skipped_count } as unknown as Commit,
      });
    }

    return NextResponse.json({
      ingested_count,
      skipped_count,
      linked_tickets: [...new Set(linked_tickets)],
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to ingest commits:', error);
    return NextResponse.json({ error: 'Failed to ingest commits' }, { status: 500 });
  }
}
