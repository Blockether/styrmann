/**
 * Lightweight LLM inference for planning decisions.
 *
 * Resolution order:
 *  1. OPENAI_API_KEY env var     → OpenAI Chat Completions API
 *  2. ANTHROPIC_API_KEY env var  → Anthropic Messages API
 *  3. ~/.opencode/config.json  → first provider with apiKey + models
 *
 * Model: cheapest fast model per provider (gpt-4o-mini / claude-haiku-4-5).
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { extractJSON } from './planning-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlmProviderConfig {
  kind: 'anthropic' | 'gemini' | 'openai-compat';
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ProviderEntry {
  baseUrl?: string;
  apiKey?: string;
  models?: Array<{ id: string; name?: string }>;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 25_000;
const MAX_CONFIG_BYTES = 1024 * 1024;

function resolveProvider(): LlmProviderConfig | null {
const overrideModel: string | undefined = undefined;

  // 1. OpenAI env var (preferred default)
  if (process.env.OPENAI_API_KEY) {
    return {
      kind: 'openai-compat',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: overrideModel || 'gpt-4o-mini',
    };
  }

  // 2. Anthropic env var
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: overrideModel || 'claude-haiku-4-5',
    };
  }

  const configPath = join(homedir(), '.opencode', 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const stats = statSync(configPath);
    if (stats.size > MAX_CONFIG_BYTES) return null;
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      models?: { providers?: Record<string, ProviderEntry> };
    };
    const providers = raw.models?.providers;
    if (!providers) return null;

    // Prefer gemini (fast, cheap), then any other with a key
    const priority = ['gemini', ...Object.keys(providers)];
    const seen = new Set<string>();
    for (const name of priority) {
      if (seen.has(name)) continue;
      seen.add(name);
      const entry = providers[name];
      if (!entry?.apiKey || !entry.models?.length) continue;

      const isGemini = name === 'gemini' || (entry.baseUrl || '').includes('googleapis.com');
      return {
        kind: isGemini ? 'gemini' : 'openai-compat',
        baseUrl: entry.baseUrl || '',
        apiKey: entry.apiKey,
        model: overrideModel || entry.models[0].id,
      };
    }
  } catch {
    // Config unreadable — fall through
  }

  return null;
}

// ---------------------------------------------------------------------------
// Provider-specific calls
// ---------------------------------------------------------------------------

async function callAnthropic(cfg: LlmProviderConfig, system: string, user: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 2048,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  });
  if (!res.ok) {
    console.warn(`[LLM] Anthropic ${res.status}: ${await res.text().catch(() => '?')}`);
    return null;
  }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

async function callGemini(cfg: LlmProviderConfig, system: string, user: string, signal: AbortSignal): Promise<string | null> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }),
    signal,
  });
  if (!res.ok) {
    console.warn(`[LLM] Gemini ${res.status}: ${await res.text().catch(() => '?')}`);
    return null;
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function callOpenAICompat(cfg: LlmProviderConfig, system: string, user: string, signal: AbortSignal): Promise<string | null> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    console.warn(`[LLM] OpenAI-compat ${res.status}: ${await res.text().catch(() => '?')}`);
    return null;
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a system+user prompt to the resolved LLM and return raw text.
 * Returns null if no provider is configured or the call fails.
 */
export async function llmInfer(system: string, user: string): Promise<string | null> {
  const cfg = resolveProvider();
  if (!cfg) {
    console.warn('[LLM] No provider configured — skipping inference');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    console.log(`[LLM] Calling ${cfg.kind}/${cfg.model} (timeout ${TIMEOUT_MS}ms)`);
    const start = Date.now();
    let text: string | null;

    switch (cfg.kind) {
      case 'anthropic':
        text = await callAnthropic(cfg, system, user, controller.signal);
        break;
      case 'gemini':
        text = await callGemini(cfg, system, user, controller.signal);
        break;
      default:
        text = await callOpenAICompat(cfg, system, user, controller.signal);
        break;
    }

    console.log(`[LLM] Response in ${Date.now() - start}ms (${text?.length ?? 0} chars)`);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[LLM] Inference timed out');
    } else {
      console.warn('[LLM] Inference failed:', err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a prompt expecting a JSON response. Parses with extractJSON().
 * Returns null if inference fails or response is not valid JSON.
 */
export async function llmJsonInfer<T = Record<string, unknown>>(system: string, user: string): Promise<T | null> {
  const text = await llmInfer(system, user);
  if (!text) return null;

  const parsed = extractJSON(text);
  if (!parsed) {
    console.warn('[LLM] Failed to extract JSON from response');
    return null;
  }
  return parsed as T;
}

/**
 * Check whether any LLM provider is available for planning.
 */
export function isLlmAvailable(): boolean {
  return resolveProvider() !== null;
}
