import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { run, queryOne, queryAll } from '@/lib/db';
import type { DiscordMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');
  const classification = searchParams.get('classification');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (workspaceId) {
    conditions.push('dm.workspace_id = ?');
    params.push(workspaceId);
  }
  if (classification) {
    conditions.push('dm.classification = ?');
    params.push(classification);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = queryAll<DiscordMessage>(
    `SELECT dm.*, t.title as task_title, t.status as task_status
     FROM discord_messages dm
     LEFT JOIN tasks t ON dm.task_id = t.id
     ${where}
     ORDER BY dm.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      discord_message_id: string;
      discord_channel_id: string;
      discord_guild_id: string;
      discord_author_id: string;
      discord_author_name: string;
      content: string;
      classification: 'task' | 'conversation' | 'clarification';
      task_id?: string;
      workspace_id?: string;
      discord_thread_id?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.discord_message_id || !body.content || !body.classification) {
      return NextResponse.json(
        { error: 'discord_message_id, content, and classification are required' },
        { status: 400 },
      );
    }

    const existing = queryOne<DiscordMessage>(
      'SELECT id FROM discord_messages WHERE discord_message_id = ?',
      [body.discord_message_id],
    );
    if (existing) {
      return NextResponse.json({ id: existing.id, exists: true });
    }

    const id = uuidv4();
    run(
      `INSERT INTO discord_messages
        (id, discord_message_id, discord_channel_id, discord_guild_id,
         discord_author_id, discord_author_name, content, classification,
         task_id, workspace_id, discord_thread_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.discord_message_id,
        body.discord_channel_id || '',
        body.discord_guild_id || '',
        body.discord_author_id || '',
        body.discord_author_name || 'Unknown',
        body.content,
        body.classification,
        body.task_id || null,
        body.workspace_id || 'default',
        body.discord_thread_id || null,
        body.metadata ? JSON.stringify(body.metadata) : null,
      ],
    );

    if (body.task_id && body.classification === 'task') {
      run(
        `INSERT INTO task_provenance (id, task_id, session_id, kind, source_channel, source_tool, receipt_text, receipt_data, message_role, message_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          body.task_id,
          null,
          'external_user',
          'discord',
          'discord-bot',
          `[Source Receipt]\ndiscord_message_id=${body.discord_message_id}\ndiscord_channel_id=${body.discord_channel_id}\ndiscord_author=${body.discord_author_name} (${body.discord_author_id})\n[/Source Receipt]`,
          JSON.stringify({
            bridge: 'discord-bot',
            discord_message_id: body.discord_message_id,
            discord_channel_id: body.discord_channel_id,
            discord_guild_id: body.discord_guild_id,
            discord_author_id: body.discord_author_id,
            discord_author_name: body.discord_author_name,
            discord_thread_id: body.discord_thread_id || undefined,
          }),
          'user',
          0,
        ],
      );
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error('[Discord Messages] Failed to store:', error);
    return NextResponse.json({ error: 'Failed to store message' }, { status: 500 });
  }
}
