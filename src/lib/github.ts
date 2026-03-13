interface GitHubRepoMeta {
  description: string | null;
  language: string | null;
  stargazers_count: number;
  open_issues_count: number;
  default_branch: string;
}

export function extractOwnerRepo(githubRepo: string): { owner: string; repo: string } | null {
  const cleaned = githubRepo
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

  const parts = cleaned.split('/');
  if (parts.length < 2) return null;

  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  if (!owner || !repo) return null;

  return { owner, repo };
}

export async function fetchRepoMeta(githubRepo: string): Promise<GitHubRepoMeta | null> {
  const parsed = extractOwnerRepo(githubRepo);
  if (!parsed) return null;

  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Blockether-Styrmann',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers,
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      console.error(`[GitHub] Failed to fetch ${parsed.owner}/${parsed.repo}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return {
      description: data.description ?? null,
      language: data.language ?? null,
      stargazers_count: data.stargazers_count ?? 0,
      open_issues_count: data.open_issues_count ?? 0,
      default_branch: data.default_branch ?? 'main',
    };
  } catch (err) {
    console.error(`[GitHub] Error fetching repo meta:`, err);
    return null;
  }
}

export async function fetchRepoDescription(githubRepo: string): Promise<string | null> {
  const meta = await fetchRepoMeta(githubRepo);
  return meta?.description ?? null;
}
