'use client';

import { ASPECT_RATIOS, type AspectRatio } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { PROJECT_PRESETS, RESOLUTION_PRESETS } from '@/lib/editor/defaults';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/input';
import { ColorControl } from './panels/controls';

export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useEditorStore((s) => s.state.settings);
  const dispatch = useEditorStore((s) => s.dispatch);

  const resolutions = RESOLUTION_PRESETS[settings.aspectRatio];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('editor.projectSettings')}
      width="sm"
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="space-y-3.5">
        <Field label="Preset">
          <Select
            value=""
            onChange={(e) => {
              const preset = PROJECT_PRESETS.find((p) => p.id === e.target.value);
              if (!preset) return;
              dispatch(
                [
                  { type: 'set_aspect_ratio', params: { aspectRatio: preset.aspectRatio, fit: 'cover' } },
                  { type: 'set_resolution', params: { width: preset.width, height: preset.height } },
                  { type: 'set_fps', params: { fps: preset.fps } },
                ],
                { label: `Use ${preset.label}` },
              );
            }}
          >
            <option value="">Choose a format…</option>
            {PROJECT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('editor.aspectRatio')}>
          <Select
            value={settings.aspectRatio}
            onChange={(e) =>
              dispatch(
                [{ type: 'set_aspect_ratio', params: { aspectRatio: e.target.value as AspectRatio, fit: 'cover' } }],
                { label: 'Aspect ratio' },
              )
            }
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('editor.resolution')}>
          <Select
            value={`${settings.width}x${settings.height}`}
            onChange={(e) => {
              const [width, height] = e.target.value.split('x').map(Number);
              dispatch([{ type: 'set_resolution', params: { width, height } }], { label: 'Resolution' });
            }}
          >
            {resolutions.map((preset) => (
              <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                {preset.label} — {preset.width}×{preset.height}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('editor.fps')}>
          <Select
            value={settings.fps}
            onChange={(e) => dispatch([{ type: 'set_fps', params: { fps: Number(e.target.value) } }], { label: 'Frame rate' })}
          >
            {[24, 25, 30, 50, 60].map((value) => (
              <option key={value} value={value}>
                {value} fps
              </option>
            ))}
          </Select>
        </Field>

        <ColorControl
          label={t('editor.background')}
          value={settings.backgroundColor}
          onCommit={(color) =>
            dispatch([{ type: 'set_background_color', params: { color } }], { label: 'Background colour' })
          }
        />
      </div>
    </Modal>
  );
}
