import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOpenClawClient } from '@/lib/openclaw/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const CANDIDATE_UNITS = [
  'openclaw-gateway.service',
  'openclaw-gateway',
  'openclaw.service',
  'openclaw',
];

const CANDIDATE_RPC_METHODS = (
  process.env.OPENCLAW_LOG_RPC_METHODS || 'logs.list,gateway.logs,system.logs,diagnostics.logs'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface JournalRecord {
  __CURSOR?: string;
  __REALTIME_TIMESTAMP?: string;
  _SOURCE_REALTIME_TIMESTAMP?: string;
  _SYSTEMD_UNIT?: string;
  SYSLOG_IDENTIFIER?: string;
  PRIORITY?: string;
  MESSAGE?: string;
}

interface GatewayLogEntry {
  id: string;
  timestamp: string;
  unit: string;
  level: LogLevel;
  message: string;
}

interface RpcLogLike {
  id?: unknown;
  timestamp?: unknown;
  time?: unknown;
  ts?: unknown;
  created_at?: unknown;
  level?: unknown;
  severity?: unknown;
  priority?: unknown;
  message?: unknown;
  msg?: unknown;
  text?: unknown;
  unit?: unknown;
  source?: unknown;
}

function clampLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '120', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 120;
  return Math.min(parsed, 400);
}

function toIsoTimestamp(record: JournalRecord): string {
  const raw = record.__REALTIME_TIMESTAMP ?? record._SOURCE_REALTIME_TIMESTAMP;
  if (!raw) return new Date().toISOString();

  const micros = Number(raw);
  if (!Number.isFinite(micros) || micros <= 0) return new Date().toISOString();

  return new Date(Math.floor(micros / 1000)).toISOString();
}

function toLevel(priorityRaw?: string): LogLevel {
  const priority = Number(priorityRaw ?? '6');
  if (priority <= 3) return 'error';
  if (priority === 4) return 'warn';
  if (priority >= 7) return 'debug';
  return 'info';
}

function normalizeLevel(value: unknown): LogLevel {
  if (typeof value === 'number') return toLevel(String(value));
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized.includes('err') || normalized === 'fatal' || normalized === 'crit') return 'error';
    if (normalized.includes('warn')) return 'warn';
    if (normalized.includes('debug') || normalized.includes('trace')) return 'debug';
  }
  return 'info';
}

function toIso(value: unknown): string {
  if (typeof value === 'number') {
    if (value > 1_000_000_000_000) return new Date(value).toISOString();
    if (value > 1_000_000_000) return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toIso(numeric);
  }
  return new Date().toISOString();
}

function normalizeRpcEntries(data: unknown, defaultUnit: string): GatewayLogEntry[] {
  const records = (() => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.entries)) return obj.entries;
      if (Array.isArray(obj.logs)) return obj.logs;
      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.messages)) return obj.messages;
    }
    return [] as unknown[];
  })();

  const normalized: GatewayLogEntry[] = [];
  for (let index = 0; index < records.length; index++) {
    const raw = records[index];

    if (typeof raw === 'string') {
      const message = raw.trim();
      if (!message) continue;
      const timestamp = new Date().toISOString();
      normalized.push({
        id: `${timestamp}:${index}`,
        timestamp,
        unit: defaultUnit,
        level: 'info',
        message,
      });
      continue;
    }

    if (!raw || typeof raw !== 'object') continue;

    const record = raw as RpcLogLike;
    const messageRaw = record.message ?? record.msg ?? record.text;
    const message = typeof messageRaw === 'string' ? messageRaw.trim() : '';
    if (!message) continue;

    const timestamp = toIso(record.timestamp ?? record.time ?? record.ts ?? record.created_at);
    const level = normalizeLevel(record.level ?? record.severity ?? record.priority);
    const unitCandidate = record.unit ?? record.source;
    const unit = typeof unitCandidate === 'string' && unitCandidate.trim() ? unitCandidate : defaultUnit;
    const idCandidate = record.id;
    const id = typeof idCandidate === 'string' && idCandidate.trim()
      ? idCandidate
      : `${timestamp}:${unit}:${index}:${message.slice(0, 48)}`;

    normalized.push({ id, timestamp, unit, level, message });
  }

  return normalized;
}

async function readLogsViaRpc(
  method: string,
  limit: number,
  search: string,
  levelFilter: string,
  from: string | null,
  to: string | null,
): Promise<GatewayLogEntry[] | null> {
  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    const params: Record<string, unknown> = {
      limit,
      search: search || undefined,
      level: levelFilter !== 'all' ? levelFilter : undefined,
      from: from || undefined,
      to: to || undefined,
    };

    const result = await client.call<unknown>(method, params);
    return normalizeRpcEntries(result, `rpc:${method}`);
  } catch {
    return null;
  }
}

function parseJournalLines(stdout: string, defaultUnit: string): GatewayLogEntry[] {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const entries: GatewayLogEntry[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as JournalRecord;
      const message = typeof record.MESSAGE === 'string' ? record.MESSAGE.trim() : '';
      if (!message) continue;

      const timestamp = toIsoTimestamp(record);
      const level = toLevel(record.PRIORITY);
      const unit = record._SYSTEMD_UNIT || record.SYSLOG_IDENTIFIER || defaultUnit;
      const idSource = record.__CURSOR || `${timestamp}:${unit}:${message}`;

      entries.push({
        id: idSource,
        timestamp,
        unit,
        level,
        message,
      });
    } catch {
      continue;
    }
  }

  return entries;
}

async function readUnitLogs(unit: string, args: string[]): Promise<GatewayLogEntry[] | null> {
  try {
    const { stdout } = await execFileAsync('journalctl', ['-u', unit, ...args], {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseJournalLines(stdout, unit);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const levelFilter = (searchParams.get('level') || 'all').toLowerCase();
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = clampLimit(searchParams.get('limit'));

    for (const method of CANDIDATE_RPC_METHODS) {
      const rpcEntries = await readLogsViaRpc(method, limit, search, levelFilter, from, to);
      if (!rpcEntries) continue;

      let rpcFiltered = rpcEntries;
      if (levelFilter !== 'all') {
        rpcFiltered = rpcFiltered.filter((entry) => entry.level === levelFilter);
      }
      if (search) {
        rpcFiltered = rpcFiltered.filter((entry) =>
          entry.message.toLowerCase().includes(search) || entry.unit.toLowerCase().includes(search),
        );
      }

      rpcFiltered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return NextResponse.json({
        source: `rpc:${method}`,
        unit: 'openclaw-gateway',
        total: rpcFiltered.length,
        limit,
        entries: rpcFiltered,
      });
    }

    const baseArgs = ['--no-pager', '--output=json', '--reverse', '-n', String(limit)];
    if (from) baseArgs.push('--since', from);
    if (to) baseArgs.push('--until', to);

    let selectedUnit = CANDIDATE_UNITS[0];
    let entries: GatewayLogEntry[] | null = null;

    for (const unit of CANDIDATE_UNITS) {
      const parsed = await readUnitLogs(unit, baseArgs);
      if (parsed === null) continue;
      selectedUnit = unit;
      entries = parsed;
      break;
    }

    if (entries === null) {
      return NextResponse.json(
        {
          error: 'OpenClaw gateway service logs are not available via journalctl',
          hint: 'Verify systemd unit name and journal access permissions',
        },
        { status: 503 },
      );
    }

    let filtered = entries;

    if (levelFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.level === levelFilter);
    }

    if (search) {
      filtered = filtered.filter((entry) =>
        entry.message.toLowerCase().includes(search) || entry.unit.toLowerCase().includes(search),
      );
    }

    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      source: 'journalctl-fallback',
      unit: selectedUnit,
      total: filtered.length,
      limit,
      entries: filtered,
    });
  } catch (error) {
    console.error('Failed to read OpenClaw gateway logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
