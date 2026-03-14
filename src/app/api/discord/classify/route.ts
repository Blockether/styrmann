import { NextRequest, NextResponse } from 'next/server';
import { classifyDiscordMessage } from '@/lib/discord-classifier';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      message: string;
      author_name?: string;
      channel_context?: string;
    };

    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (body.message.length > 4000) {
      return NextResponse.json({ error: 'message exceeds 4000 character limit' }, { status: 400 });
    }

    const classification = await classifyDiscordMessage(
      body.message,
      body.author_name,
      body.channel_context,
    );

    return NextResponse.json(classification);
  } catch (error) {
    console.error('[Discord Classify] Failed:', error);
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
