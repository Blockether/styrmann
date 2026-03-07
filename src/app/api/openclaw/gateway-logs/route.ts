import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const CANDIDATE_UNITS = [
  'openclaw-gateway.service',
  'openclaw-gateway',
  'openclaw.service',
  'openclaw',
];

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

    const baseArgs = ['--no-pager', '--output=json', '-n', String(limit)];
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

    return NextResponse.json({
      source: 'journalctl',
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
