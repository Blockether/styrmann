import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type { ValidationCheck, ValidationResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROJECT_DIR = '/root/repos/blockether/mission-control';
const DB_CANDIDATES = [
    process.env.STYRMAN_DATABASE_PATH,
  path.join(PROJECT_DIR, 'mission-control.db'),
  path.join(PROJECT_DIR, 'styrmann.db'),
  path.join(PROJECT_DIR, 'styrmann'),
].filter((value): value is string => Boolean(value));
const DB_PATH = DB_CANDIDATES.find((candidate) => existsSync(candidate)) || DB_CANDIDATES[0];
const ENV_FILE = `${PROJECT_DIR}/.env.local`;
const PUBLIC_URL = 'https://control.blockether.com';
const LOCAL_URL = 'http://localhost:4000';
  const REQUIRED_VARS = ['STYRMAN_API_TOKEN'];

type CheckResult = {
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
  repairable?: boolean;
  repair_prompt?: string;
};

function check(
  name: string,
  category: 'system' | 'agent',
  fn: () => CheckResult,
): ValidationCheck {
  try {
    return { name, category, ...fn() };
  } catch (err) {
    return { name, category, status: 'fail', message: String(err) };
  }
}

export async function POST() {
  const checks: ValidationCheck[] = [];

  checks.push(check('Environment File', 'system', () => {
    if (!existsSync(ENV_FILE)) {
      return {
        status: 'fail',
        message: '.env.local not found',
        repairable: true,
      repair_prompt: 'The .env.local file is missing from the Styrmann project directory at /root/repos/blockether/mission-control. Create it with the required environment variables: STYRMAN_API_TOKEN. Check /root/repos/blockether/mission-control/.env.example for the template.',
      };
    }
    return { status: 'pass', message: '.env.local exists' };
  }));

  if (existsSync(ENV_FILE)) {
    const envContent = readFileSync(ENV_FILE, 'utf8');
    for (const varName of REQUIRED_VARS) {
      checks.push(check(`Env: ${varName}`, 'system', () => {
        const regex = new RegExp(`^${varName}=.+`, 'm');
        if (regex.test(envContent)) {
          return { status: 'pass', message: `${varName} is set` };
        }
        return {
          status: 'warn',
          message: `${varName} is not set in .env.local`,
          repairable: true,
          repair_prompt: `The environment variable ${varName} is missing or empty in /root/repos/blockether/mission-control/.env.local. Add it with the correct value. Check .env.example for the expected format.`,
        };
      }));
    }
  }

  checks.push(check('Database', 'system', () => {
    if (!existsSync(DB_PATH)) {
      return {
        status: 'fail',
        message: 'Database not found',
        details: DB_PATH,
        repairable: true,
        repair_prompt: `The SQLite database is missing at ${DB_PATH}. Run the Styrmann migrations or restart the web service to auto-create the database. Command: cd ${PROJECT_DIR} && npx tsx src/lib/db/migrate.ts`,
      };
    }
    return { status: 'pass', message: 'Database exists' };
  }));

  if (existsSync(DB_PATH)) {
    checks.push(check('Database Tables', 'system', () => {
      try {
        const result = execSync(
          `sqlite3 "${DB_PATH}" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null`,
          { encoding: 'utf8', timeout: 5000 },
        ).trim();
        const count = parseInt(result, 10);
        if (count === 0) {
          return {
            status: 'fail',
            message: 'No tables found — database may need migration',
            repairable: true,
            repair_prompt: `The database at ${DB_PATH} has no tables. Run migrations: cd ${PROJECT_DIR} && npx tsx src/lib/db/migrate.ts`,
          };
        }
        return { status: 'pass', message: `${result} tables found` };
      } catch {
        return { status: 'warn', message: 'Could not query tables (sqlite3 CLI not installed?)' };
      }
    }));

    checks.push(check('Migrations', 'system', () => {
      try {
        const result = execSync(
          `sqlite3 "${DB_PATH}" "SELECT count(*) FROM _migrations;" 2>/dev/null`,
          { encoding: 'utf8', timeout: 5000 },
        ).trim();
        return { status: 'pass', message: `${result} migrations applied` };
      } catch {
        return { status: 'warn', message: 'Could not query migrations table' };
      }
    }));
  }

  checks.push(check('Web Service', 'system', () => {
    try {
      const result = execSync('systemctl is-active mission-control 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (result === 'active') {
        const uptimeRaw = execSync(
          'systemctl show mission-control --property=ActiveEnterTimestamp --no-pager 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 },
        ).trim().split('=')[1] || 'unknown';
        return { status: 'pass', message: 'Service is running', details: `Since ${uptimeRaw}` };
      }
      return {
        status: 'fail',
        message: `Service is ${result}`,
        repairable: true,
        repair_prompt: 'The mission-control systemd service is not running. Restart it: sudo systemctl restart mission-control. Check logs: journalctl -u mission-control -n 50 --no-pager',
      };
    } catch {
      return {
        status: 'fail',
        message: 'Service is not running or systemctl unavailable',
        repairable: true,
        repair_prompt: 'The mission-control systemd service is not running. Restart it: sudo systemctl restart mission-control. If the service file is missing, check /etc/systemd/system/mission-control.service.',
      };
    }
  }));

  checks.push(check('Daemon Service', 'system', () => {
    try {
      const result = execSync('systemctl is-active mission-control-daemon 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (result === 'active') {
        const uptimeRaw = execSync(
          'systemctl show mission-control-daemon --property=ActiveEnterTimestamp --no-pager 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 },
        ).trim().split('=')[1] || 'unknown';
        return { status: 'pass', message: 'Daemon is running', details: `Since ${uptimeRaw}` };
      }
      return {
        status: 'fail',
        message: `Daemon is ${result}`,
        repairable: true,
        repair_prompt: 'The mission-control-daemon systemd service is not running. Restart it: sudo systemctl restart mission-control-daemon. Check logs: journalctl -u mission-control-daemon -n 50 --no-pager',
      };
    } catch {
      return {
        status: 'fail',
        message: 'Daemon is not running or systemctl unavailable',
        repairable: true,
        repair_prompt: 'The mission-control-daemon systemd service is not running. Restart it: sudo systemctl restart mission-control-daemon. If the service file is missing, check /etc/systemd/system/mission-control-daemon.service.',
      };
    }
  }));

  checks.push(check('HTTP Endpoint', 'system', () => {
    try {
      const localCode = execSync(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${LOCAL_URL}" 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 },
      ).trim();

      if (localCode !== '200') {
        return {
          status: 'fail',
          message: `Local endpoint (localhost:4000) returned HTTP ${localCode}`,
          repairable: true,
          repair_prompt: 'The Styrmann web server on localhost:4000 is not responding correctly. Check if the service is running: systemctl status mission-control. Restart if needed: sudo systemctl restart mission-control.',
        };
      }

      const publicCode = execSync(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${PUBLIC_URL}" 2>/dev/null`,
        { encoding: 'utf8', timeout: 15000 },
      ).trim();

      if (publicCode === '200') {
        return { status: 'pass', message: `${PUBLIC_URL} responding 200` };
      }
      if (publicCode === '000') {
        return {
          status: 'warn',
          message: `Local OK, but ${PUBLIC_URL} not reachable (DNS/proxy issue)`,
          details: 'localhost:4000 responds 200 but public URL is not reachable — likely a DNS, firewall, or reverse proxy issue',
          repairable: true,
          repair_prompt: `The local web server is running fine on localhost:4000 but the public URL ${PUBLIC_URL} is not reachable. Check: 1) DNS for control.blockether.com 2) Nginx/Caddy reverse proxy config 3) Firewall rules for port 443. Run: nginx -t && systemctl status nginx`,
        };
      }
      return {
        status: 'warn',
        message: `Local OK, but ${PUBLIC_URL} returned HTTP ${publicCode}`,
        details: `localhost:4000 responds 200, public URL returns ${publicCode}`,
      };
    } catch {
      return {
        status: 'fail',
        message: 'HTTP endpoint check failed',
        repairable: true,
        repair_prompt: 'Could not reach the Styrmann web server. Restart: sudo systemctl restart mission-control. Then verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:4000',
      };
    }
  }));

  checks.push(check('OpenCode CLI', 'system', () => {
    try {
      const result = execSync('which opencode 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
      if (result) {
        return { status: 'pass', message: 'OpenCode CLI available', details: result };
      }
      return {
        status: 'warn',
        message: 'OpenCode CLI not found in PATH',
        repairable: true,
        repair_prompt: 'Install OpenCode CLI so Styrmann can dispatch tasks to agent sessions. See https://opencode.ai for installation instructions.',
      };
    } catch {
      return {
        status: 'warn',
        message: 'OpenCode CLI not found in PATH',
        repairable: true,
        repair_prompt: 'Install OpenCode CLI so Styrmann can dispatch tasks to agent sessions.',
      };
    }
  }));

  const errors = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;

  const result: ValidationResult = {
    passed: errors === 0,
    checks,
    errors,
    warnings,
    ran_at: new Date().toISOString(),
  };

  return NextResponse.json(result);
}
