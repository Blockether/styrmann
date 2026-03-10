import { NextRequest, NextResponse } from 'next/server';
import { getMemoryPipelineAgentsStatus, getMemoryPipelineConfig, updateMemoryPipelineConfig } from '@/lib/openclaw-memory';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = getMemoryPipelineConfig();
    const agents = getMemoryPipelineAgentsStatus();
    return NextResponse.json({ config, agents });
  } catch (error) {
    console.error('Failed to fetch memory pipeline config:', error);
    return NextResponse.json({ error: 'Failed to fetch memory pipeline config' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Partial<{
      enabled: number;
      llm_enabled: number;
      schedule_cron: string;
      top_k: number;
      llm_model: string;
      llm_base_url: string;
      summary_prompt: string;
    }>;

    const update: Record<string, unknown> = {};
    if (body.enabled !== undefined) update.enabled = body.enabled ? 1 : 0;
    if (body.llm_enabled !== undefined) update.llm_enabled = body.llm_enabled ? 1 : 0;
    if (body.schedule_cron !== undefined) update.schedule_cron = body.schedule_cron;
    if (body.top_k !== undefined) update.top_k = Math.max(1, Math.min(100, Number(body.top_k)));
    if (body.llm_model !== undefined) update.llm_model = String(body.llm_model);
    if (body.llm_base_url !== undefined) update.llm_base_url = String(body.llm_base_url);
    if (body.summary_prompt !== undefined) update.summary_prompt = String(body.summary_prompt);

    const config = updateMemoryPipelineConfig(update as never);
    return NextResponse.json({ config });
  } catch (error) {
    console.error('Failed to update memory pipeline config:', error);
    return NextResponse.json({ error: 'Failed to update memory pipeline config' }, { status: 500 });
  }
}
