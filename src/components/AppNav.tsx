'use client';

import Link from 'next/link';
import { StyrmannLogo } from '@/components/StyrmannLogo';

export function AppNav() {
  return (
    <header data-component="src/components/AppNav" className="bg-mc-bg-secondary border-b border-mc-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-14">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <StyrmannLogo size={28} />
            <span className="font-mono font-medium text-lg">Styrmann</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
