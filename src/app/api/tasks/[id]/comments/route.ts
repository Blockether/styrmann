import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskComment } from '@/lib/types';

export const dynamic = 'force-dynamic';

function mapTaskComment(row: {
  id: string;
  task_id: string;
  author: string;
  content: string;
  created_at: string;
  updated_at: string;
}): TaskComment {
  return {
    id: row.id,
    task_id: row.task_id,
    author: row.author,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDb();

    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const rows = db.prepare(`
      SELECT id, task_id, author, content, created_at, updated_at
      FROM task_comments
      WHERE task_id = ?
      ORDER BY created_at DESC
    `).all(id) as {
      id: string;
      task_id: string;
      author: string;
      content: string;
      created_at: string;
      updated_at: string;
    }[];

    return NextResponse.json(rows.map(mapTaskComment));
  } catch (error) {
    console.error('Failed to fetch task comments:', error);
    return NextResponse.json({ error: 'Failed to fetch task comments' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json() as { author?: unknown; content?: unknown };
    const { author, content } = body;

    if (typeof author !== 'string' || author.trim().length === 0) {
      return NextResponse.json({ error: 'author is required' }, { status: 400 });
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id) as { id: string } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_comments (id, task_id, author, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(commentId, id, author.trim(), content.trim(), now, now);

    const created = db.prepare(`
      SELECT id, task_id, author, content, created_at, updated_at
      FROM task_comments
      WHERE id = ?
    `).get(commentId) as {
      id: string;
      task_id: string;
      author: string;
      content: string;
      created_at: string;
      updated_at: string;
    };

    return NextResponse.json(mapTaskComment(created), { status: 201 });
  } catch (error) {
    console.error('Failed to create task comment:', error);
    return NextResponse.json({ error: 'Failed to create task comment' }, { status: 500 });
  }
}
