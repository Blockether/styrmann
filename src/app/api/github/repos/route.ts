import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const REPOS_BASE = '/root/repos';

interface GhRepo {
  name: string;
  description: string;
}

/**
 * GET /api/github/repos?org=Blockether
 *
 * Lists all repos for a GitHub org via `gh repo list`.
 * Marks which ones are already cloned locally.
 */
export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get('org');

  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  try {
    const output = execSync(
      `gh repo list ${org} --json name,description --limit 100`,
      { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    ).toString();

    const repos: GhRepo[] = JSON.parse(output);
    const orgDir = path.join(REPOS_BASE, org.toLowerCase());

    const result = repos.map((r) => {
      const repoPath = path.join(orgDir, r.name);
      const cloned = fs.existsSync(path.join(repoPath, '.git'));
      return {
        name: r.name,
        fullName: `${org}/${r.name}`,
        description: r.description || null,
        cloned,
      };
    });

    // Sort: uncloned first, then alphabetically
    result.sort((a, b) => {
      if (a.cloned !== b.cloned) return a.cloned ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GitHub] Failed to list repos:', msg);
    return NextResponse.json({ error: 'Failed to list repos from GitHub' }, { status: 500 });
  }
}
