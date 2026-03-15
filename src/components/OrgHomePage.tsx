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
    <div data-component="src/components/OrgHomePage" className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header />

      <main className="flex-1 min-w-0 overflow-y-auto p-3 md:p-4">
        <h1 className="text-lg font-semibold text-mc-text mb-6">Organizations</h1>

        {loading && (
          <div className="text-sm text-mc-text-secondary">Loading...</div>
        )}

        {error && (
          <div className="text-sm text-mc-accent-red">{error}</div>
        )}

        {!loading && !error && orgs.length === 0 && (
          <div className="rounded border border-mc-border bg-mc-bg-secondary min-h-[260px] flex items-center justify-center px-6">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 size={32} className="text-mc-text-secondary mb-4" />
              <h2 className="text-lg font-semibold mb-2 text-mc-text">No organizations found</h2>
              <p className="text-sm text-mc-text-secondary max-w-md mb-6">
                Organizations appear here after at least one workspace is linked to an organization.
              </p>
              <Link href="/" className="px-4 py-2 text-sm border border-mc-border rounded hover:bg-mc-bg">
                Browse all workspaces
              </Link>
            </div>
          </div>
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
                    <span className="text-base font-semibold text-mc-text">{org.name}</span>
                  </div>
                  <ChevronRight size={14} className="text-mc-text-secondary shrink-0 mt-0.5" />
                </div>
                {org.description && (
                  <p className="mt-2 text-sm text-mc-text-secondary line-clamp-2">{org.description}</p>
                )}
                <div className="mt-3 flex items-center gap-1 text-sm text-mc-text-secondary">
                  <Folder size={12} />
                  <span>{org.workspace_count} workspace{org.workspace_count !== 1 ? 's' : ''}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
