'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Film, Sparkles, Settings } from 'lucide-react';
import { useT } from '@/lib/i18n/context';
import { cn } from '@/lib/utils/cn';

const ITEMS = [
  { href: '/dashboard', icon: LayoutGrid, key: 'dashboard.nav.dashboard' },
  { href: '/projects', icon: Film, key: 'dashboard.nav.projects' },
  { href: '/templates', icon: Sparkles, key: 'dashboard.nav.templates' },
  { href: '/settings', icon: Settings, key: 'dashboard.nav.settings' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav className="flex shrink-0 flex-row gap-1 border-b border-line px-3 py-2 md:w-56 md:flex-col md:border-b-0 md:border-r md:px-3 md:py-4">
      <Link href="/dashboard" className="mb-4 hidden items-center gap-2 px-2 md:flex">
        <span className="grid h-6 w-6 place-items-center rounded-sm bg-accent text-[11px] font-bold text-white">V</span>
        <span className="text-[15px] font-semibold tracking-tight">VideoAI</span>
      </Link>
      {ITEMS.map(({ href, icon: Icon, key }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
              active ? 'bg-elevated font-medium text-ink' : 'text-ink-muted hover:bg-elevated/60 hover:text-ink',
            )}
          >
            <Icon size={15} className={active ? 'text-accent' : ''} />
            <span>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
