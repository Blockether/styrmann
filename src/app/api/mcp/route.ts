import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const TOOLS = [
  {
    name: 'mc_status',
    description: 'Show Mission Control workspace status overview.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
      },
    },
  },
  {
    name: 'mc_task_list',
    description: 'List Mission Control tasks with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        status: { type: 'string' },
        assigned_agent_id: { type: 'string' },
        task_type: { type: 'string' },
        backlog: { type: ['string', 'boolean'] },
      },
    },
  },
  {
    name: 'mc_task_get',
    description: 'Get one Mission Control task by id.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'mc_task_log',
    description: 'Post an activity log entry for a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        message: { type: 'string' },
        activity_type: { type: 'string' },
        agent_id: { type: 'string' },
      },
      required: ['task_id', 'message'],
    },
  },
  {
    name: 'mc_task_status',
    description: 'Update a task status.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'mc_agent_list',
    description: 'List agents for a workspace.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: { type: 'string' } },
    },
  },
  {
    name: 'mc_acp_bindings',
    description: 'List ACP bindings for a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        status: { type: 'string' },
        agent_id: { type: 'string' },
        discord_thread_id: { type: 'string' },
      },
    },
  },
];

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

async function apiCall(request: NextRequest, path: string, method = 'GET', body?: unknown) {
  const origin = request.nextUrl.origin;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = request.headers.get('authorization');
  if (auth) headers.authorization = auth;

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error?: unknown }).error)
      : `HTTP ${response.status}`;
    return { ok: false, error: message, status: response.status };
  }

  return { ok: true, data: payload };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  const id = body.id ?? null;
  const method = body.method;
  const params = body.params || {};

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mission-control-nextjs', version: '1.0.0' },
    });
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = asString(params.name) || '';
    const args = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {});

    const workspaceId = asString(args.workspace_id) || 'default';

    let result: { ok: boolean; data?: unknown; error?: string; status?: number };

    if (toolName === 'mc_status') {
      const [agents, tasks, sprints] = await Promise.all([
        apiCall(request, '/api/agents'),
        apiCall(request, `/api/tasks?workspace_id=${encodeURIComponent(workspaceId)}&status=in_progress,assigned,review,testing`),
        apiCall(request, `/api/sprints?workspace_id=${encodeURIComponent(workspaceId)}`),
      ]);

      if (!agents.ok) result = agents;
      else if (!tasks.ok) result = tasks;
      else if (!sprints.ok) result = sprints;
      else {
        const sprintList = Array.isArray(sprints.data) ? sprints.data : [];
        const activeSprint = sprintList.find((s) => typeof s === 'object' && s && (s as { status?: unknown }).status === 'active') || null;
        result = {
          ok: true,
          data: {
            workspace_id: workspaceId,
            active_sprint: activeSprint,
            agents: agents.data,
            active_tasks: tasks.data,
          },
        };
      }
    } else if (toolName === 'mc_task_list') {
      const query = new URLSearchParams();
      query.set('workspace_id', workspaceId);
      for (const key of ['status', 'assigned_agent_id', 'task_type', 'backlog']) {
        const value = args[key];
        if (typeof value === 'string' && value.length > 0) query.set(key, value);
        if (typeof value === 'boolean') query.set(key, String(value));
      }
      result = await apiCall(request, `/api/tasks?${query.toString()}`);
    } else if (toolName === 'mc_task_get') {
      const taskId = asString(args.task_id);
      if (!taskId) return jsonRpcError(id, -32602, 'task_id is required');
      result = await apiCall(request, `/api/tasks/${encodeURIComponent(taskId)}`);
    } else if (toolName === 'mc_task_log') {
      const taskId = asString(args.task_id);
      const messageValue = asString(args.message);
      if (!taskId || !messageValue) return jsonRpcError(id, -32602, 'task_id and message are required');
      result = await apiCall(request, `/api/tasks/${encodeURIComponent(taskId)}/activities`, 'POST', {
        activity_type: asString(args.activity_type) || 'updated',
        message: messageValue,
        agent_id: asString(args.agent_id),
      });
    } else if (toolName === 'mc_task_status') {
      const taskId = asString(args.task_id);
      const status = asString(args.status);
      if (!taskId || !status) return jsonRpcError(id, -32602, 'task_id and status are required');
      result = await apiCall(request, `/api/tasks/${encodeURIComponent(taskId)}`, 'PATCH', { status });
    } else if (toolName === 'mc_agent_list') {
      result = await apiCall(request, '/api/agents');
    } else if (toolName === 'mc_acp_bindings') {
      const query = new URLSearchParams();
      query.set('workspace_id', workspaceId);
      for (const key of ['status', 'agent_id', 'discord_thread_id']) {
        const value = asString(args[key]);
        if (value) query.set(key, value);
      }
      result = await apiCall(request, `/api/acp/bindings?${query.toString()}`);
    } else {
      return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
    }

    return jsonRpcResult(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  }

  return jsonRpcError(id, -32601, `Method not found: ${String(method)}`);
}
