import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

export interface AcpDispatchOptions {
  sessionKey: string;
  message: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface AcpDispatchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

export async function dispatchToOpenCode(options: AcpDispatchOptions): Promise<AcpDispatchResult> {
  const { sessionKey, message, cwd = process.cwd() } = options;

  return new Promise((resolve) => {
    try {
      const child = spawn('opencode', ['--session', sessionKey], {
        cwd,
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      child.stdin?.write(message);
      child.stdin?.end();
      child.unref();

      resolve({ success: true, pid: child.pid });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[ACP] Failed to dispatch to OpenCode:', error);
      resolve({ success: false, error });
    }
  });
}

export function getAcpStatus(): { available: boolean; path?: string } {
  try {
    const path = execSync('which opencode', { encoding: 'utf-8' }).trim();
    return { available: existsSync(path), path };
  } catch {
    return { available: false };
  }
}
