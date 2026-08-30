'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, Play, Plus, Search } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { SFX_LIBRARY, renderSfx, type SfxCategory } from '@/lib/media/sfx';
import type { DictionaryKey } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils/cn';

const CATEGORY_ORDER: SfxCategory[] = ['whoosh', 'impact', 'ui', 'comedy', 'musical'];

/** The library is one list; its wording follows the interface language. */
const soundName = (id: string) => `sfx.${id}` as DictionaryKey;
const soundAbout = (id: string) => `sfx.${id}.about` as DictionaryKey;
const categoryLabel = (id: SfxCategory) => `sfx.category.${id}` as DictionaryKey;

/**
 * The built-in sound library. Every sound is synthesised in the browser the
 * moment it is used, so the panel works offline and nothing has to be licensed.
 */
export function SoundsPanel() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SfxCategory | 'all'>('all');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef(new Map<string, string>());

  const dispatch = useEditorStore((s) => s.dispatch);

  const preview = useCallback(async (id: string) => {
    setPreviewing(id);
    try {
      let url = urlCache.current.get(id);
      if (!url) {
        url = URL.createObjectURL(await renderSfx(id));
        urlCache.current.set(id, url);
      }
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch {
      // Autoplay policies can refuse before the first user gesture; the click
      // that got us here counts as one, so a failure is not worth surfacing.
    } finally {
      setPreviewing(null);
    }
  }, []);

  const add = useCallback(
    (id: string) => {
      const store = useEditorStore.getState();
      // The editor root watches for placeholder sounds and renders, uploads and
      // signs them, so nothing else is needed here.
      dispatch([{ type: 'add_sound_effect', params: { sound: id, start: store.playhead } }], {
        label: `Add ${id.replace(/_/g, ' ')}`,
      });
    },
    [dispatch],
  );

  const visible = SFX_LIBRARY.filter((sfx) => {
    if (category !== 'all' && sfx.category !== category) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    // Search the translated wording as well as the English original, so
    // "platestopp" and "record scratch" both find the same sound.
    return [sfx.name, sfx.description, t(soundName(sfx.id)), t(soundAbout(sfx.id))].some((text) =>
      text.toLowerCase().includes(needle),
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="h-7 w-full rounded-sm border border-line bg-base pr-2 pl-6 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(['all', ...CATEGORY_ORDER] as const).map((id) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] transition-colors',
                category === id ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:text-ink',
              )}
            >
              {id === 'all' ? t('editor.allSounds') : t(categoryLabel(id))}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[11px] text-ink-faint">{t('editor.soundsHint')}</p>
        <div className="space-y-1.5">
          {visible.map((sfx) => (
            <div
              key={sfx.id}
              className="group flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1.5 transition-colors hover:border-line-strong"
            >
              <button
                onClick={() => void preview(sfx.id)}
                title={t('editor.play')}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-elevated text-ink-muted transition-colors hover:text-ink"
              >
                {previewing === sfx.id ? (
                  <Loader2 size={12} className="animate-spin-slow" />
                ) : (
                  <Play size={12} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-ink">{t(soundName(sfx.id))}</p>
                <p className="truncate text-[10.5px] text-ink-faint">
                  {sfx.duration.toFixed(2)}s · {t(soundAbout(sfx.id))}
                </p>
              </div>
              <button
                onClick={() => add(sfx.id)}
                title={t('editor.addAtPlayhead')}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition-all group-hover:opacity-100 hover:bg-elevated hover:text-ink focus:opacity-100"
              >
                <Plus size={13} />
              </button>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="mt-6 text-center text-[12px] text-ink-faint">{t('editor.noResults')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
