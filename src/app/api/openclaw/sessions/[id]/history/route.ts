import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';
interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/openclaw/sessions/[id]/history - Get conversation history (id = session key)
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // id is the session key (e.g. 'agent:main:mission-control-user')
    const rawMessages = await client.getSessionHistory(id);

    // Normalize: content blocks array → plain string, timestamp millis → ISO
    const history = rawMessages.map((raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      let content: string;
      if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n');
      } else {
        content = String(msg.content || '');
      }
      const timestamp = typeof msg.timestamp === 'number'
        ? new Date(msg.timestamp).toISOString()
        : (msg.timestamp as string | undefined);
      return { role: msg.role as string, content, timestamp };
    });

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Failed to get OpenClaw session history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
