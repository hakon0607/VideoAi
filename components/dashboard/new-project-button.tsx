'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/lib/i18n/context';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PROJECT_PRESETS } from '@/lib/editor/defaults';
import { createProjectAction } from '@/lib/actions/projects';

export function NewProjectButton({ presetId }: { presetId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> {t('dashboard.newProject')}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('dashboard.newProject.title')} width="sm">
        <form action={createProjectAction} onSubmit={() => setSubmitting(true)} className="space-y-4">
          <Field label={t('dashboard.newProject.name')}>
            <Input name="name" autoFocus placeholder="My podcast episode" />
          </Field>
          <Field label={t('dashboard.newProject.preset')}>
            <Select name="preset" defaultValue={presetId ?? 'youtube_1080p'}>
              {PROJECT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {t('dashboard.newProject.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
