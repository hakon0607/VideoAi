'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Copy, Film, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { formatClock, relativeTime } from '@/lib/utils/format';
import { deleteProjectAction, duplicateProjectAction, renameProjectAction } from '@/lib/actions/projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

export interface ProjectSummary {
  id: string;
  name: string;
  aspectRatio: string;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [pending, startTransition] = useTransition();

  const vertical = project.aspectRatio === '9:16' || project.aspectRatio === '4:5';

  function handleRename() {
    startTransition(async () => {
      await renameProjectAction(project.id, name);
      setRenaming(false);
      router.refresh();
    });
  }

  function handleDuplicate() {
    setMenuOpen(false);
    startTransition(async () => {
      await duplicateProjectAction(project.id);
      router.refresh();
    });
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(t('dashboard.deleteConfirm', { name: project.name }))) return;
    startTransition(async () => {
      await deleteProjectAction(project.id);
      router.refresh();
    });
  }

  return (
    <div className="group relative">
      <Link
        href={`/editor/${project.id}`}
        className="block overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-line-strong"
      >
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-base">
          {project.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnailUrl}
              alt=""
              className={vertical ? 'h-full w-auto object-cover' : 'h-full w-full object-cover'}
            />
          ) : (
            <Film size={22} className="text-ink-faint/60" />
          )}
          {project.durationSeconds > 0 && (
            <span className="absolute right-2 bottom-2 rounded-xs bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white/90 tabular-nums">
              {formatClock(project.durationSeconds)}
            </span>
          )}
          <span className="absolute left-2 bottom-2 rounded-xs bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white/80">
            {project.aspectRatio}
          </span>
        </div>
        <div className="px-3 py-2.5">
          <p className="truncate text-[13px] font-medium text-ink">{project.name}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {t('dashboard.editedAgo', { time: relativeTime(project.updatedAt, locale) })}
          </p>
        </div>
      </Link>

      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((v) => !v);
          }}
          aria-label="Project actions"
          className="grid h-7 w-7 place-items-center rounded-sm border border-line-strong bg-black/70 text-ink backdrop-blur-sm transition-colors hover:bg-black/85"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-pop animate-fade-in">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <Pencil size={13} /> {t('common.rename')}
              </button>
              <button
                onClick={handleDuplicate}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <Copy size={13} /> {t('common.duplicate')}
              </button>
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] text-danger transition-colors hover:bg-danger/10"
              >
                <Trash2 size={13} /> {t('common.delete')}
              </button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('common.rename')}
        width="sm"
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleRename} loading={pending}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          autoFocus
        />
      </Modal>
    </div>
  );
}
