'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useT } from '@/lib/i18n/context';
import { Input, Select } from '@/components/ui/input';
import { ProjectCard, type ProjectSummary } from './project-card';

type SortKey = 'updated' | 'created' | 'name' | 'duration';

export function ProjectGrid({
  projects,
  showControls = true,
  emptyTitle,
  emptyBody,
}: {
  projects: ProjectSummary[];
  showControls?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? projects.filter((p) => p.name.toLowerCase().includes(needle)) : projects;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'duration':
          return b.durationSeconds - a.durationSeconds;
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [projects, query, sort]);

  return (
    <div className="space-y-4">
      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              className="pl-8.5"
            />
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-44">
            <option value="updated">{t('dashboard.sort.updated')}</option>
            <option value="created">{t('dashboard.sort.created')}</option>
            <option value="name">{t('dashboard.sort.name')}</option>
            <option value="duration">{t('dashboard.sort.duration')}</option>
          </Select>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-[14px] font-medium text-ink">
            {projects.length === 0 ? (emptyTitle ?? t('dashboard.empty.title')) : t('dashboard.noMatches')}
          </p>
          {projects.length === 0 && (
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
              {emptyBody ?? t('dashboard.empty.body')}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
