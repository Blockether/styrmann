import { redirect } from 'next/navigation';
import { isSingularOrgMode } from '@/lib/org-config';
import { OrgHomePage } from '@/components/OrgHomePage';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (isSingularOrgMode()) {
    const { getDb } = await import('@/lib/db');
    const db = getDb();
    const org = db.prepare(`
      SELECT o.slug FROM organizations o
      JOIN workspaces w ON w.organization_id = o.id
      WHERE COALESCE(w.is_internal, 0) = 0
      LIMIT 1
    `).get() as { slug: string } | undefined;

    if (org) {
      redirect(`/organization/${org.slug}`);
    }
  }

  return <OrgHomePage />;
}
