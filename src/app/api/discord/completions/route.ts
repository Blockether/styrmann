import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pending = queryAll<{
      id: string;
      discord_message_id: string;
      discord_channel_id: string;
      discord_guild_id: string;
      discord_author_id: string;
      discord_author_name: string;
      discord_thread_id: string | null;
      task_id: string;
      task_title: string;
      task_status: string;
    }>(
      `SELECT dm.id, dm.discord_message_id, dm.discord_channel_id, dm.discord_guild_id,
              dm.discord_author_id, dm.discord_author_name, dm.discord_thread_id, dm.task_id,
              t.title as task_title, t.status as task_status
       FROM discord_messages dm
       JOIN tasks t ON t.id = dm.task_id
       WHERE dm.task_id IS NOT NULL
         AND dm.completion_notified = 0
         AND t.status = 'done'
       ORDER BY t.updated_at DESC
       LIMIT 50`,
      [],
    );

    return NextResponse.json(pending);
  } catch (error) {
    console.error('[Discord Completions] Failed to query:', error);
    return NextResponse.json({ error: 'Failed to query completions' }, { status: 500 });
  }
}
