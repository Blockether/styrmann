'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { StyrmannLogo } from '@/components/StyrmannLogo';

interface Props {
  orgName?: string;
  orgSlug?: string;
  workspaceName?: string;
}

export function AppNav({ orgName, orgSlug, workspaceName }: Props) {
  return (
    <header data-component="src/components/AppNav" className="bg-mc-bg-secondary border-b border-mc-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-14">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <StyrmannLogo size={28} />
            <span className="font-mono font-medium text-lg">Styrmann</span>
          </Link>
          {orgName && (
            <>
              <ChevronRight size={14} className="mx-2 text-mc-text-secondary" />
              <Link href={orgSlug ? `/org/${orgSlug}` : '/'} className="font-mono text-sm text-mc-text-secondary hover:text-mc-text transition-colors truncate max-w-[200px]">
                {orgName}
              </Link>
            </>
          )}
          {workspaceName && (
            <>
              <ChevronRight size={14} className="mx-2 text-mc-text-secondary" />
              <span className="font-mono text-sm text-mc-text-secondary truncate max-w-[200px]">{workspaceName}</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
