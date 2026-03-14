import { NextRequest, NextResponse } from 'next/server';
import { generateConversationalResponse } from '@/lib/discord-classifier';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      message: string;
      author_name?: string;
      context?: string;
    };

    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (body.message.length > 4000) {
      return NextResponse.json({ error: 'message exceeds 4000 character limit' }, { status: 400 });
    }

    const response = await generateConversationalResponse(
      body.message,
      body.author_name,
      body.context,
    );

    if (!response) {
      return NextResponse.json({
        response: 'I received your message but cannot generate a response right now. No LLM provider is configured.',
        fallback: true,
      });
    }

    return NextResponse.json({ response, fallback: false });
  } catch (error) {
    console.error('[Discord Respond] Failed:', error);
    return NextResponse.json({ error: 'Response generation failed' }, { status: 500 });
  }
}
