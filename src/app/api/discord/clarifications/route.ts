import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { run, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      discord_channel_id: string;
      discord_author_id: string;
      original_message_id: string;
      original_content: string;
      question: string;
      classification_data?: unknown;
      workspace_id?: string;
    };

    if (!body.discord_channel_id || !body.discord_author_id || !body.original_message_id || !body.question) {
      return NextResponse.json(
        { error: 'discord_channel_id, discord_author_id, original_message_id, and question are required' },
        { status: 400 },
      );
    }

    const existing = queryOne<{ id: string }>(
      `SELECT id FROM discord_clarification_contexts
       WHERE discord_channel_id = ? AND discord_author_id = ? AND status = 'pending'`,
      [body.discord_channel_id, body.discord_author_id],
    );
    if (existing) {
      run(
        `UPDATE discord_clarification_contexts SET status = 'expired', resolved_at = datetime('now') WHERE id = ?`,
        [existing.id],
      );
    }

    const id = uuidv4();
    run(
      `INSERT INTO discord_clarification_contexts
        (id, discord_channel_id, discord_author_id, original_message_id, original_content, question, classification_data, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.discord_channel_id,
        body.discord_author_id,
        body.original_message_id,
        body.original_content,
        body.question,
        body.classification_data ? JSON.stringify(body.classification_data) : null,
        body.workspace_id || 'default',
      ],
    );

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error('[Discord Clarifications] Failed to store:', error);
    return NextResponse.json({ error: 'Failed to store clarification context' }, { status: 500 });
  }
}
