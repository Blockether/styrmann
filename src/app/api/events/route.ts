import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, run } from '@/lib/db';
import type { Event } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GET /api/events - List events (live feed)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const since = searchParams.get('since'); // ISO timestamp for polling
    const workspaceId = searchParams.get('workspace_id');

    let sql = `
      SELECT e.*, a.name as agent_name, t.title as task_title
      FROM events e
      LEFT JOIN agents a ON e.agent_id = a.id
      LEFT JOIN tasks t ON e.task_id = t.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (workspaceId) {
      sql += ' AND (t.workspace_id = ? OR (t.id IS NULL AND a.id IS NULL))';
      params.push(workspaceId);
    }

    if (since) {
      sql += ' AND e.created_at > ?';
      params.push(since);
    }

    sql += ' ORDER BY e.created_at DESC LIMIT ?';
    params.push(limit);

    const events = queryAll<Event & { agent_name?: string; task_title?: string }>(sql, params);

    // Transform to include nested info
    const transformedEvents = events.map((event) => ({
      ...event,
      agent: event.agent_id
        ? {
            id: event.agent_id,
            name: event.agent_name,
          }
        : undefined,
      task: event.task_id
        ? {
            id: event.task_id,
            title: event.task_title,
          }
        : undefined,
    }));

    return NextResponse.json(transformedEvents);
  } catch (error) {
    console.error('Failed to fetch events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/events - Create a manual event
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.type || !body.message) {
      return NextResponse.json({ error: 'Type and message are required' }, { status: 400 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    run(
      `INSERT INTO events (id, type, agent_id, task_id, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.type,
        body.agent_id || null,
        body.task_id || null,
        body.message,
        body.metadata ? JSON.stringify(body.metadata) : null,
        now,
      ]
    );

    return NextResponse.json({ id, type: body.type, message: body.message, created_at: now }, { status: 201 });
  } catch (error) {
    console.error('Failed to create event:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
