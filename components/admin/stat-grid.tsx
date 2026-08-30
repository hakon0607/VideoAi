'use client';

import { cn } from '@/lib/utils/cn';

export interface Stat {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

/** Compact KPI row. Numbers are tabular so columns line up as they change. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={cn(
            'rounded-lg border bg-surface px-4 py-3.5',
            stat.accent ? 'border-accent/40' : 'border-line',
          )}
        >
          <p className="text-[11px] font-medium tracking-wider text-ink-faint uppercase">{stat.label}</p>
          <p className="mt-1 text-[22px] leading-none font-semibold tabular-nums text-ink">{stat.value}</p>
          {stat.hint && <p className="mt-1.5 text-[11.5px] text-ink-muted">{stat.hint}</p>}
        </div>
      ))}
    </div>
  );
}
