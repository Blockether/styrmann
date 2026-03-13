import { spawn } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, openSync, closeSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

export interface AcpDispatchOptions {
  sessionKey: string;
  message: string;
  cwd?: string;
  outputDir?: string;
  timeoutMs?: number;
}

export interface AcpDispatchResult {
  success: boolean;
  pid?: number;
  tracePath?: string;
  error?: string;
}

function getLogPath(): string {
  const dir = path.join(process.cwd(), '.next');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, 'dispatch.log');
}

function getSessionTracePath(outputDir: string | undefined, sessionKey: string): string {
  const dir = outputDir || path.join(process.cwd(), '.next', 'traces');
  mkdirSync(dir, { recursive: true });
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safeKey}.trace.jsonl`);
}

export async function dispatchToOpenCode(options: AcpDispatchOptions): Promise<AcpDispatchResult> {
  const { sessionKey, message, cwd = process.cwd(), outputDir } = options;
  const logPath = getLogPath();
  const tracePath = getSessionTracePath(outputDir, sessionKey);

  return new Promise((resolve) => {
    try {
      const args = ['run', '--format', 'json', '--title', sessionKey, '--dir', cwd, message];

      let stdoutFd: number;
      let stderrFd: number;
      try {
        stdoutFd = openSync(tracePath, 'a');
        stderrFd = openSync(tracePath.replace(/\.jsonl$/, '.stderr.log'), 'a');
      } catch (fdErr) {
        const error = fdErr instanceof Error ? fdErr.message : String(fdErr);
        const line = `[${new Date().toISOString()}] [ACP] failed to open trace files session=${sessionKey}: ${error}\n`;
        try { appendFileSync(logPath, line); } catch {}
        console.error('[ACP] Failed to open trace files:', error);
        resolve({ success: false, error: `Failed to open trace files: ${error}` });
        return;
      }

      const child = spawn('opencode', args, {
        cwd,
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      });

      child.on('error', (err) => {
        const line = `[${new Date().toISOString()}] [ACP] spawn error session=${sessionKey}: ${err.message}\n`;
        try { appendFileSync(logPath, line); } catch {}
        console.error('[ACP] Spawn error:', err.message);
      });

      child.on('exit', (code, signal) => {
        try { closeSync(stdoutFd); } catch {}
        try { closeSync(stderrFd); } catch {}

        const exitLine = `[${new Date().toISOString()}] [ACP] exit code=${code} signal=${signal} session=${sessionKey} trace=${tracePath}\n`;
        try { appendFileSync(logPath, exitLine); } catch {}
        if (code !== 0 && code !== null) {
          console.error(`[ACP] opencode exited code=${code} session=${sessionKey}`);
        }
      });

      child.unref();

      const startLine = `[${new Date().toISOString()}] [ACP] dispatched pid=${child.pid} session=${sessionKey} trace=${tracePath}\n`;
      try { appendFileSync(logPath, startLine); } catch {}

      resolve({ success: true, pid: child.pid, tracePath });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const line = `[${new Date().toISOString()}] [ACP] dispatch failed session=${sessionKey}: ${error}\n`;
      try { appendFileSync(logPath, line); } catch {}
      console.error('[ACP] Failed to dispatch to OpenCode:', error);
      resolve({ success: false, error });
    }
  });
}

export function getAcpStatus(): { available: boolean; path?: string } {
  try {
    const p = execSync('which opencode', { encoding: 'utf-8' }).trim();
    return { available: existsSync(p), path: p };
  } catch {
    return { available: false };
  }
}
