import { createLogger } from './logger';
import { mcFetch } from './bridge';
import type { DaemonConfig, DaemonStats } from './types';

const log = createLogger('synthesis');

const SYNTHESIS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface OrgInfo {
  id: string;
  name: string;
}

interface SynthesisResult {
  articles_created?: number;
  articles_updated?: number;
}

export function startSynthesis(config: DaemonConfig, stats: DaemonStats): () => void {
  async function tick() {
    try {
      const orgsRes = await mcFetch('/api/organizations');
      if (!orgsRes.ok) {
        log.warn(`Failed to fetch organizations: ${orgsRes.status}`);
        return;
      }

      const orgs: OrgInfo[] = await orgsRes.json();
      if (!orgs || !Array.isArray(orgs)) return;

      for (const org of orgs) {
        try {
          const res = await mcFetch('/api/knowledge/synthesize', {
            method: 'POST',
            body: JSON.stringify({ organization_id: org.id }),
          });

          if (!res.ok) {
            log.warn(`Synthesis request failed for org ${org.name} (${org.id}): ${res.status}`);
            continue;
          }

          const result: SynthesisResult = await res.json();

          if (result?.articles_created && result.articles_created > 0) {
            log.info(`Created ${result.articles_created} articles for org: ${org.name}`);
            stats.synthesisCount = (stats.synthesisCount || 0) + result.articles_created;
          }
        } catch (e) {
          log.error(`Failed for org ${org.id}:`, e);
        }
      }

      stats.lastSynthesisTick = new Date().toISOString();
    } catch (e) {
      log.error('Tick failed:', e);
    }
  }

  const initialTimeout = setTimeout(tick, 30_000);
  const id = setInterval(tick, SYNTHESIS_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(id);
  };
}
