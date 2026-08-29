'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/context';
import { PROJECT_PRESETS } from '@/lib/editor/defaults';
import { createProjectAction } from '@/lib/actions/projects';
import { Button } from '@/components/ui/button';

const RATIO_BOX: Record<string, string> = {
  '16:9': 'aspect-video w-full',
  '9:16': 'aspect-[9/16] w-14',
  '1:1': 'aspect-square w-20',
  '4:5': 'aspect-[4/5] w-16',
  '21:9': 'aspect-[21/9] w-full',
  '4:3': 'aspect-[4/3] w-24',
};

export function TemplatesView() {
  const t = useT();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{t('dashboard.templates.title')}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t('dashboard.templates.body')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROJECT_PRESETS.map((preset) => (
          <form
            key={preset.id}
            action={createProjectAction}
            onSubmit={() => setPendingId(preset.id)}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
          >
            <input type="hidden" name="preset" value={preset.id} />
            <input type="hidden" name="name" value={preset.label} />
            <div className="flex h-24 items-center justify-center rounded-md bg-base">
              <div className={`${RATIO_BOX[preset.aspectRatio] ?? 'aspect-video w-full'} max-h-20 rounded-sm border border-line-strong bg-elevated`} />
            </div>
            <div>
              <p className="text-[13px] font-medium text-ink">{preset.label}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-faint">
                {preset.width}×{preset.height} · {preset.fps} fps
              </p>
            </div>
            <Button type="submit" size="sm" variant="primary" loading={pendingId === preset.id}>
              {t('dashboard.newProject.create')}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
