import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

const OPENCLAW_BIN = '/root/.npm-global/bin/openclaw';

/**
 * POST /api/openclaw/security-audit
 *
 * Runs `openclaw security audit` with optional --deep and --fix flags.
 * Returns structured JSON output from the CLI.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { deep = false, fix = false } = body as { deep?: boolean; fix?: boolean };

    const args = ['security', 'audit', '--json'];
    if (deep) args.push('--deep');
    if (fix) args.push('--fix');

    const cmd = `${OPENCLAW_BIN} ${args.join(' ')}`;

    let stdout: string;
    try {
      stdout = execSync(cmd, {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });
    } catch (err: unknown) {
      // openclaw may exit non-zero when findings exist — still has valid JSON on stdout
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      if (execErr.stdout) {
        stdout = execErr.stdout;
      } else {
        return NextResponse.json(
          { success: false, error: execErr.message ?? 'Command failed' },
          { status: 500 },
        );
      }
    }

    // Try to parse JSON output; fall back to raw text
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      success: true,
      mode: fix ? 'fix' : deep ? 'deep' : 'standard',
      result: parsed,
      raw: parsed ? undefined : stdout,
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Security audit failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
