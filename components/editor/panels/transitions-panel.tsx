'use client';

import { TRANSITION_TYPES } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { clipsAreAdjacent, clipsOnTrack } from '@/lib/editor/selectors';
import type { DictionaryKey } from '@/lib/i18n/dictionaries';

export function TransitionsPanel() {
  const { t } = useI18n();
  const selection = useEditorStore((s) => s.selection.clipIds);
  const state = useEditorStore((s) => s.state);
  const dispatch = useEditorStore((s) => s.dispatch);

  const clip = state.clips.find((c) => c.id === selection[0]);
  const siblings = clip ? clipsOnTrack(state, clip.trackId) : [];
  const index = clip ? siblings.findIndex((c) => c.id === clip.id) : -1;
  const next = index >= 0 ? siblings[index + 1] : undefined;
  const adjacent = clip && next ? clipsAreAdjacent(clip, next) : false;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {!clip ? (
        <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-faint">{t('editor.noSelection')}</p>
      ) : (
        <>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-muted">
            {adjacent
              ? t('editor.transitionBetween', { a: clip.name, b: next?.name ?? '' })
              : t('editor.transitionAtEnd', { a: clip.name })}
          </p>
          <div className="space-y-1.5">
            {TRANSITION_TYPES.map((type) => (
              <button
                key={type}
                onClick={() =>
                  adjacent && next
                    ? dispatch(
                        [
                          {
                            type: 'add_transition_between',
                            params: { fromClipId: clip.id, toClipId: next.id, type, duration: 0.5 },
                          },
                        ],
                        { label: `Add ${type}` },
                      )
                    : dispatch(
                        [{ type: 'add_transition', params: { clipId: clip.id, position: 'out', type } }],
                        { label: `Add ${type}` },
                      )
                }
                className="w-full rounded-md border border-line bg-base px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-elevated"
              >
                <span className="block text-[12px] text-ink">{t(`transition.${type}` as DictionaryKey)}</span>
                <span className="mt-0.5 block text-[10.5px] text-ink-faint">
                  {t(`transition.${type}.about` as DictionaryKey)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
