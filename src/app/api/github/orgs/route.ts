import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

interface GhAccount {
  login: string;
  type: 'user' | 'org';
}

/**
 * GET /api/github/orgs
 *
 * Lists the authenticated GitHub user and their organizations.
 * Returns an array of { login, type } sorted: user first, then orgs alphabetically.
 */
export async function GET() {
  try {
    const ghEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const accounts: GhAccount[] = [];

    // Get authenticated user
    try {
      const userOutput = execSync('gh api user --jq .login', { timeout: 15_000, env: ghEnv }).toString().trim();
      if (userOutput) {
        accounts.push({ login: userOutput, type: 'user' });
      }
    } catch (e) {
      console.error('[GitHub] Failed to get user:', e instanceof Error ? e.message : e);
    }

    // Get user's organizations
    try {
      const orgsOutput = execSync('gh api user/orgs --jq ".[].login"', { timeout: 15_000, env: ghEnv }).toString().trim();
      if (orgsOutput) {
        for (const org of orgsOutput.split('\n').filter(Boolean)) {
          accounts.push({ login: org, type: 'org' });
        }
      }
    } catch (e) {
      console.error('[GitHub] Failed to list orgs:', e instanceof Error ? e.message : e);
    }

    if (accounts.length === 0) {
      return NextResponse.json({ error: 'No GitHub accounts found. Is gh CLI authenticated?' }, { status: 500 });
    }

    return NextResponse.json(accounts);
  } catch (error) {
    console.error('[GitHub] Failed to list accounts:', error);
    return NextResponse.json({ error: 'Failed to list GitHub accounts' }, { status: 500 });
  }
}
