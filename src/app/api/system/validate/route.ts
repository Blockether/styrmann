import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';
import { getHimalayaStatus } from '@/lib/himalaya';
import type { ValidationCheck, ValidationResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROJECT_DIR = '/root/repos/blockether/mission-control';
const DB_PATH = `${PROJECT_DIR}/mission-control.db`;
const ENV_FILE = `${PROJECT_DIR}/.env.local`;
const PUBLIC_URL = 'https://control.blockether.com';
const LOCAL_URL = 'http://localhost:4000';
const REQUIRED_VARS = ['OPENCLAW_GATEWAY_URL', 'OPENCLAW_GATEWAY_TOKEN', 'MC_API_TOKEN'];

type CheckResult = {
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
  repairable?: boolean;
  repair_prompt?: string;
};

function check(
  name: string,
  category: 'system' | 'openclaw',
  fn: () => CheckResult,
): ValidationCheck {
  try {
    return { name, category, ...fn() };
  } catch (err) {
    return { name, category, status: 'fail', message: String(err) };
  }
}

async function checkAsync(
  name: string,
  category: 'system' | 'openclaw',
  fn: () => Promise<CheckResult>,
): Promise<ValidationCheck> {
  try {
    return { name, category, ...(await fn()) };
  } catch (err) {
    return { name, category, status: 'fail', message: String(err) };
  }
}

/**
 * POST /api/system/validate - Run validation checks
 *
 * Performs comprehensive system + OpenClaw doctor checks.
 * Returns grouped results: system infrastructure + OpenClaw diagnostics.
 */
export async function POST() {
  const checks: ValidationCheck[] = [];

  // ── System checks ────────────────────────────────────────────────────

  // Step 1: Environment file
  checks.push(check('Environment File', 'system', () => {
    if (!existsSync(ENV_FILE)) {
      return {
        status: 'fail',
        message: '.env.local not found',
        repairable: true,
        repair_prompt: 'The .env.local file is missing from the Mission Control project directory at /root/repos/blockether/mission-control. Create it with the required environment variables: OPENCLAW_GATEWAY_URL, OPENCLAW_GATEWAY_TOKEN, MC_API_TOKEN. Check /root/repos/blockether/mission-control/.env.example for the template.',
      };
    }
    return { status: 'pass', message: '.env.local exists' };
  }));

  // Step 1b: Required environment variables
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

  // Step 2: Database
  checks.push(check('Database', 'system', () => {
    if (!existsSync(DB_PATH)) {
      return {
        status: 'fail',
        message: 'Database not found',
        details: DB_PATH,
        repairable: true,
        repair_prompt: `The SQLite database is missing at ${DB_PATH}. Run the Mission Control migrations or restart the web service to auto-create the database. Command: cd ${PROJECT_DIR} && npx tsx src/lib/db/migrate.ts`,
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

  // Step 3: Web service
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

  // Step 4: Daemon service
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

  // Step 5: HTTP endpoint — use localhost to avoid DNS/TLS issues during restart
  checks.push(check('HTTP Endpoint', 'system', () => {
    try {
      // Check local first (reliable), then public URL
      const localCode = execSync(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${LOCAL_URL}" 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 },
      ).trim();

      if (localCode !== '200') {
        return {
          status: 'fail',
          message: `Local endpoint (localhost:4000) returned HTTP ${localCode}`,
          repairable: true,
          repair_prompt: 'The Mission Control web server on localhost:4000 is not responding correctly. Check if the service is running: systemctl status mission-control. Restart if needed: sudo systemctl restart mission-control.',
        };
      }

      // Local OK — now check public URL
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
        repair_prompt: 'Could not reach the Mission Control web server. Restart: sudo systemctl restart mission-control. Then verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:4000',
      };
    }
  }));

  checks.push(check('Himalaya CLI', 'system', () => {
    const db = getDb();
    const workspace = db.prepare("SELECT coordinator_email, himalaya_account FROM workspaces WHERE id = 'default'").get() as { coordinator_email?: string | null; himalaya_account?: string | null } | undefined;
    const status = getHimalayaStatus(workspace?.himalaya_account || null);
    if (!status.installed) {
      return {
        status: 'fail',
        message: 'Himalaya CLI not installed',
        repairable: true,
        repair_prompt: 'Install Himalaya CLI and configure at least one account before assigning tasks to humans.',
      };
    }
    if (!status.configured) {
      return {
        status: 'warn',
        message: 'Himalaya CLI installed but no accounts configured',
        repairable: true,
        repair_prompt: 'Run himalaya account configure or provide a valid config.toml so Mission Control can send assignment emails.',
      };
    }
    if (!workspace?.coordinator_email) {
      return {
        status: 'warn',
        message: 'Coordinator sender email is not configured for the default workspace',
        repairable: true,
        repair_prompt: 'Set coordinator_email on the default workspace and choose a Himalaya account so Mission Control knows which sender address to use.',
      };
    }
    if (!status.healthy_account) {
      return {
        status: 'warn',
        message: status.error || 'Configured Himalaya account failed doctor checks',
        repairable: true,
        repair_prompt: 'Fix the selected Himalaya account credentials or pick another configured account in workspace settings.',
      };
    }
    return {
      status: 'pass',
      message: `Himalaya ready (${status.configured_account})`,
      details: `Sender: ${workspace.coordinator_email}`,
    };
  }));

  // ── OpenClaw Doctor checks ───────────────────────────────────────────

  const client = getOpenClawClient();

  // Doctor: Gateway Connection
  checks.push(await checkAsync('Gateway Connection', 'openclaw', async () => {
    try {
      if (!client.isConnected()) {
        await client.connect();
      }
      if (client.isConnected()) {
        const gatewayUrl = (process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789')
          .replace(/token=[^&]+/gi, 'token=***');
        return { status: 'pass', message: 'Connected to OpenClaw Gateway', details: gatewayUrl };
      }
      return {
        status: 'fail',
        message: 'Not connected to OpenClaw Gateway',
        repairable: true,
        repair_prompt: 'The OpenClaw Gateway WebSocket connection failed. Check: 1) Is the OpenClaw Gateway process running? 2) Is OPENCLAW_GATEWAY_URL correct in .env.local? 3) Is OPENCLAW_GATEWAY_TOKEN valid? Run: systemctl status openclaw-gateway or check the OpenClaw process.',
      };
    } catch (err) {
      return {
        status: 'fail',
        message: `Gateway connection failed: ${err instanceof Error ? err.message : String(err)}`,
        repairable: true,
        repair_prompt: `OpenClaw Gateway connection error: ${err instanceof Error ? err.message : String(err)}. Verify the gateway is running and the URL/token in .env.local are correct.`,
      };
    }
  }));

  // Only run RPC checks if connected
  if (client.isConnected()) {
    // Doctor: Agents
    checks.push(await checkAsync('Agents Available', 'openclaw', async () => {
      try {
        const agents = await client.listAgents();
        if (agents.length === 0) {
          return {
            status: 'warn',
            message: 'No agents registered in OpenClaw Gateway',
            repairable: true,
            repair_prompt: 'No agents are registered in the OpenClaw Gateway. Check the agent configuration files and ensure agents are properly defined. The gateway should auto-discover agents from config directories.',
          };
        }
        const names = (agents as Array<{ name?: string; id?: string }>)
          .map(a => a.name || a.id)
          .filter(Boolean);
        return {
          status: 'pass',
          message: `${agents.length} agent(s) available`,
          details: names.join(', '),
        };
      } catch (err) {
        return {
          status: 'fail',
          message: `agents.list RPC failed: ${err instanceof Error ? err.message : String(err)}`,
          repairable: true,
          repair_prompt: `The agents.list RPC call to OpenClaw Gateway failed: ${err instanceof Error ? err.message : String(err)}. The gateway may be in a bad state — try restarting it.`,
        };
      }
    }));

    // Doctor: Models
    checks.push(await checkAsync('Models Available', 'openclaw', async () => {
      try {
        const models = await client.listModels();
        if (models.length === 0) {
          return {
            status: 'warn',
            message: 'No models available from gateway',
            repairable: true,
            repair_prompt: 'No AI models are available from the OpenClaw Gateway. Check: 1) API provider keys are configured 2) Model configuration in OpenClaw config 3) Provider connectivity (OpenAI, Anthropic, etc.)',
          };
        }
        const modelNames = models.map(m => m.name || m.id);
        return {
          status: 'pass',
          message: `${models.length} model(s) available`,
          details: modelNames.join(', '),
        };
      } catch (err) {
        return {
          status: 'fail',
          message: `models.list RPC failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }));

    // Doctor: Config
    checks.push(await checkAsync('Gateway Config', 'openclaw', async () => {
      try {
        const config = await client.getConfig();
        const defaultModel = config?.config?.agents?.defaults?.model?.primary;
        if (defaultModel) {
          return {
            status: 'pass',
            message: 'Gateway config loaded',
            details: `Default model: ${defaultModel}`,
          };
        }
        return {
          status: 'warn',
          message: 'Gateway config loaded but no default model set',
          repairable: true,
          repair_prompt: 'The OpenClaw Gateway config does not specify a default primary model. Set agents.defaults.model.primary in the OpenClaw configuration file.',
        };
      } catch (err) {
        return {
          status: 'fail',
          message: `config.get RPC failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }));

    // Doctor: Sessions
    checks.push(await checkAsync('Active Sessions', 'openclaw', async () => {
      try {
        const sessions = await client.listSessions();
        return {
          status: 'pass',
          message: `${sessions.length} active session(s)`,
          details: sessions.length > 0
            ? sessions.slice(0, 5).map(s => s.id).join(', ')
            : undefined,
        };
      } catch (err) {
        return {
          status: 'fail',
          message: `sessions.list RPC failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }));

    // Doctor: Nodes
    checks.push(await checkAsync('Connected Nodes', 'openclaw', async () => {
      try {
        const nodes = await client.listNodes();
        const nodeArr = Array.isArray(nodes) ? nodes : [];
        if (nodeArr.length === 0) {
          return {
            status: 'warn',
            message: 'No nodes connected to gateway',
            repairable: true,
            repair_prompt: 'No compute nodes are connected to the OpenClaw Gateway. Ensure at least one OpenClaw node process is running and can reach the gateway.',
          };
        }
        return {
          status: 'pass',
          message: `${nodeArr.length} node(s) connected`,
        };
      } catch (err) {
        return {
          status: 'warn',
          message: `node.list RPC returned error: ${err instanceof Error ? err.message : String(err)}`,
          details: 'Node listing may not be supported by this gateway version',
        };
      }
    }));
  }

  // ── Agent credential health checks (inheritance model) ───────────────
  // OpenClaw uses credential inheritance: sub-agents inherit auth-profiles from the
  // main agent via loadAuthProfileStoreForRuntime merge. Sub-agents should NOT have
  // their own auth-profiles.json -- that's a stale override risk.
  checks.push(check('Agent Credentials', 'openclaw', () => {
    try {
      const db = getDb();
      const agents = db.prepare(
        "SELECT id, name, agent_dir, gateway_agent_id FROM agents WHERE agent_dir IS NOT NULL AND agent_dir != ''"
      ).all() as Array<{ id: string; name: string; agent_dir: string; gateway_agent_id: string | null }>;

      if (agents.length === 0) {
        return { status: 'pass', message: 'No agents with local directories configured' };
      }

      // 1. Find and validate main agent credentials (source of truth)
      const mainAgent = agents.find(a => a.gateway_agent_id === 'main' || a.name.toLowerCase() === 'main');
      if (!mainAgent) {
        return {
          status: 'warn',
          message: 'No main agent found -- cannot verify credential inheritance',
          repairable: false,
        };
      }

      const mainAuthPath = `${mainAgent.agent_dir}/auth-profiles.json`;
      if (!existsSync(mainAuthPath)) {
        return {
          status: 'fail',
          message: 'Main agent has no auth-profiles.json -- all sub-agents will lack credentials',
          repairable: true,
          repair_prompt: 'The main agent is missing auth-profiles.json. Run: openclaw models auth login --provider <provider> to set up OAuth credentials. The main agent\'s credentials are inherited by all sub-agents.',
        };
      }

      let mainProfiles: Record<string, Record<string, unknown>> = {};
      try {
        const mainAuth = JSON.parse(readFileSync(mainAuthPath, 'utf8'));
        mainProfiles = mainAuth.profiles || {};
      } catch {
        return {
          status: 'fail',
          message: 'Main agent auth-profiles.json is corrupted',
          repairable: true,
          repair_prompt: `The main agent auth-profiles.json at ${mainAuthPath} could not be parsed. Re-authenticate: openclaw models auth login --provider <provider>`,
        };
      }

      const mainProviderNames = Object.keys(mainProfiles).map(k => k.split(':')[0]);
      if (mainProviderNames.length === 0) {
        return {
          status: 'fail',
          message: 'Main agent auth-profiles.json has no provider profiles',
          repairable: true,
          repair_prompt: 'The main agent auth-profiles.json exists but has no profiles configured. Run: openclaw models auth login --provider <provider>',
        };
      }

      // 2. Check OAuth token expiry on main agent profiles
      const issues: string[] = [];
      const now = Date.now();
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;

      for (const [profileKey, profile] of Object.entries(mainProfiles)) {
        const p = profile as { type?: string; expires?: number; errorCount?: number };
        if (p.type === 'oauth' && typeof p.expires === 'number') {
          if (p.expires < now) {
            issues.push(`${profileKey}: OAuth token EXPIRED`);
          } else if (p.expires - now < ONE_DAY_MS) {
            const hoursLeft = Math.round((p.expires - now) / (60 * 60 * 1000));
            issues.push(`${profileKey}: OAuth token expires in ${hoursLeft}h`);
          }
        }
      }

      // 3. Check for sub-agents with their OWN auth-profiles (stale override risk)
      const staleOverrides: string[] = [];
      const subAgents = agents.filter(a => a.gateway_agent_id !== 'main' && a.name.toLowerCase() !== 'main');

      for (const agent of subAgents) {
        const authPath = `${agent.agent_dir}/auth-profiles.json`;
        if (existsSync(authPath)) {
          staleOverrides.push(agent.name);

          // Also check for error stats in the sub-agent file
          try {
            const authData = JSON.parse(readFileSync(authPath, 'utf8'));
            const usageStats = authData.usageStats || {};
            for (const [key, stats] of Object.entries(usageStats)) {
              const s = stats as { errorCount?: number; cooldownUntil?: number };
              if (s.cooldownUntil && s.cooldownUntil > now) {
                issues.push(`${agent.name}/${key}: in error cooldown (stale override)`);
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }

      if (staleOverrides.length > 0) {
        issues.push(`Sub-agents with own auth-profiles (stale override risk): ${staleOverrides.join(', ')}`);
      }

      // 4. Build result
      const hasExpiredTokens = issues.some(i => i.includes('EXPIRED'));
      const hasStaleOverrides = staleOverrides.length > 0;

      if (hasExpiredTokens) {
        return {
          status: 'fail',
          message: issues.join('. '),
          details: `Main agent providers: ${mainProviderNames.join(', ')}. ${subAgents.length} sub-agent(s) inherit via OpenClaw credential merge.`,
          repairable: true,
          repair_prompt: 'One or more OAuth tokens on the main agent have expired. Re-authenticate: openclaw models auth login --provider <provider>. This will also sync tokens to sub-agents via syncSiblingAgents.',
        };
      }

      if (issues.length > 0 || hasStaleOverrides) {
        return {
          status: 'warn',
          message: issues.join('. '),
          details: `Main agent providers: ${mainProviderNames.join(', ')}. ${subAgents.length} sub-agent(s) inherit via OpenClaw credential merge.`,
          repairable: hasStaleOverrides,
          repair_prompt: hasStaleOverrides
            ? `Sub-agent(s) ${staleOverrides.join(', ')} have their own auth-profiles.json which may override inherited main credentials with stale values. Delete these files to restore proper credential inheritance.`
            : undefined,
        };
      }

      return {
        status: 'pass',
        message: `Main agent credentials healthy (${mainProviderNames.join(', ')}). ${subAgents.length} sub-agent(s) inherit via OpenClaw merge.`,
      };
    } catch (err) {
      return { status: 'warn', message: `Credential check error: ${err instanceof Error ? err.message : String(err)}` };
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
