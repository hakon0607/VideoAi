'use client';

import { EFFECT_TYPES } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { EFFECT_DEFAULTS } from '@/lib/editor/defaults';
import type { DictionaryKey } from '@/lib/i18n/dictionaries';

export function EffectsPanel() {
  const { t } = useI18n();
  const selection = useEditorStore((s) => s.selection.clipIds);
  const clips = useEditorStore((s) => s.state.clips);
  const dispatch = useEditorStore((s) => s.dispatch);

  const target = clips.find((c) => c.id === selection[0] && c.kind !== 'audio');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {!target ? (
        <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-faint">{t('editor.noSelection')}</p>
      ) : (
        <>
          <p className="mb-3 truncate text-[11.5px] text-ink-muted">
            {t('common.add')} → <span className="text-ink">{target.name}</span>
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {EFFECT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() =>
                  dispatch(
                    [{ type: 'add_effect', params: { clipId: target.id, type, params: EFFECT_DEFAULTS[type] } }],
                    { label: `Add ${type}` },
                  )
                }
                className="rounded-md border border-line bg-base px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-elevated"
              >
                <span className="block text-[12px] text-ink">{t(`effect.${type}` as DictionaryKey)}</span>
                <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-faint">
                  {t(`effect.${type}.about` as DictionaryKey)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
