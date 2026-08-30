'use client';

import { useT } from '@/lib/i18n/context';
import { LocalMediaSweeper } from './local-media-sweeper';
import { NewProjectButton } from './new-project-button';
import { ProjectGrid } from './project-grid';
import type { ProjectSummary } from './project-card';

function greetingKey(): 'dashboard.greeting.morning' | 'dashboard.greeting.afternoon' | 'dashboard.greeting.evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'dashboard.greeting.morning';
  if (hour < 18) return 'dashboard.greeting.afternoon';
  return 'dashboard.greeting.evening';
}

export function DashboardView({ name, projects }: { name: string; projects: ProjectSummary[] }) {
  const t = useT();
  const recent = projects.slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl space-y-9">
      <LocalMediaSweeper />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            {t(greetingKey())}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t('app.tagline')}</p>
        </div>
        <NewProjectButton />
      </div>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-ink-faint">
            {t('dashboard.recent')}
          </h2>
          <ProjectGrid projects={recent} showControls={false} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-ink-faint">{t('dashboard.all')}</h2>
        <ProjectGrid projects={projects} />
      </section>
    </div>
  );
}
