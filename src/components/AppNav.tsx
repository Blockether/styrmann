'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Activity } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Workspaces', icon: LayoutGrid },
  { href: '/operations', label: 'Operations', icon: Activity },
] as const;

export function AppNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <header data-component="src/components/AppNav" className="bg-mc-bg-secondary border-b border-mc-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Left: Logo + Title */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image src="/logo.png" alt="Styrmann" width={28} height={28} className="rounded" />
            <span className="font-mono font-medium text-lg">Styrmann</span>
          </Link>

          {/* Right: Nav Links */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                    active
                      ? 'bg-mc-bg text-mc-text font-medium border border-mc-border'
                      : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
