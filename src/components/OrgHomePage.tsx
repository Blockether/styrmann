'use client';
import { Building2, Folder, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  workspace_count: number;
}

export function OrgHomePage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/organizations')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setOrgs(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError('Failed to load organizations'); setLoading(false); });
  }, []);

  return (
    <div data-component="src/components/OrgHomePage" className="min-h-screen bg-mc-bg">
      <Header />

      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="font-mono text-lg font-bold text-mc-text mb-6">Organizations</h1>

        {loading && (
          <div className="text-sm text-mc-text-secondary">Loading...</div>
        )}

        {error && (
          <div className="text-sm text-mc-accent-red">{error}</div>
        )}

        {!loading && !error && orgs.length === 0 && (
          <div className="text-sm text-mc-text-secondary">No organizations found.</div>
        )}

        {!loading && orgs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map(org => (
              <Link
                key={org.id}
                href={`/organization/${org.slug}`}
                className="block p-4 rounded border border-mc-border bg-mc-bg-secondary hover:border-mc-accent transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 size={16} className="text-mc-accent shrink-0 mt-0.5" />
                    <span className="font-mono text-sm font-semibold text-mc-text">{org.name}</span>
                  </div>
                  <ChevronRight size={14} className="text-mc-text-secondary shrink-0 mt-0.5" />
                </div>
                {org.description && (
                  <p className="mt-2 text-xs text-mc-text-secondary line-clamp-2">{org.description}</p>
                )}
                <div className="mt-3 flex items-center gap-1 text-xs text-mc-text-secondary">
                  <Folder size={12} />
                  <span>{org.workspace_count} workspace{org.workspace_count !== 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
