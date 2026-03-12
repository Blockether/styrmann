import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';
interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalizeHistoryMessage(raw: unknown): { role: string; content: string; timestamp?: string } {
  const msg = raw as Record<string, unknown>;
  const textParts: string[] = [];

  if (Array.isArray(msg.content)) {
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && block.text) {
        textParts.push(String(block.text));
      } else if (block.type === 'tool_use' || block.type === 'toolUse' || block.type === 'toolCall') {
        const input = block.input || block.arguments;
        const renderedInput = input
          ? (typeof input === 'string' ? input : JSON.stringify(input, null, 2))
          : '';
        textParts.push(`[tool call] ${String(block.name || block.toolName || 'unknown')}${renderedInput ? `\n${renderedInput}` : ''}`);
      } else if ((block.type === 'tool_result' || block.type === 'toolResult') && (block.content || block.output || block.text)) {
        const result = block.content || block.output || block.text;
        textParts.push(`[tool result]\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`);
      }
    }
  } else if (msg.content) {
    textParts.push(String(msg.content));
  }

  if (Array.isArray(msg.tool_calls) && textParts.length === 0) {
    for (const call of msg.tool_calls as Array<Record<string, unknown>>) {
      const fn = (call.function && typeof call.function === 'object') ? call.function as Record<string, unknown> : null;
      const name = String(fn?.name || call.name || 'unknown');
      const args = typeof fn?.arguments === 'string' ? fn.arguments : (call.arguments ? JSON.stringify(call.arguments, null, 2) : '');
      textParts.push(`[tool call] ${name}${args ? `\n${args}` : ''}`);
    }
  }

  const timestamp = typeof msg.timestamp === 'number'
    ? new Date(msg.timestamp).toISOString()
    : (msg.timestamp as string | undefined);

  return {
    role: String(msg.role || 'unknown'),
    content: textParts.join('\n').trim(),
    timestamp,
  };
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
    const history = rawMessages
      .map(normalizeHistoryMessage)
      .filter((message) => message.content.trim().length > 0 || message.role !== 'assistant');

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Failed to get OpenClaw session history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
