'use client';

import { useT } from '@/lib/i18n/context';
import { NewProjectButton } from './new-project-button';
import { ProjectGrid } from './project-grid';
import type { ProjectSummary } from './project-card';

export function ProjectsView({ projects }: { projects: ProjectSummary[] }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{t('dashboard.nav.projects')}</h1>
        <NewProjectButton />
      </div>
      <ProjectGrid projects={projects} />
    </div>
  );
}
