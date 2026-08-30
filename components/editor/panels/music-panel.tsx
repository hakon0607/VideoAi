'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, Play, Plus, Square } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { MUSIC_LIBRARY, renderMusic, type MusicMood } from '@/lib/media/music';
import { timelineDuration } from '@/lib/editor/selectors';
import { cn } from '@/lib/utils/cn';

const MOODS: (MusicMood | 'all')[] = ['all', 'upbeat', 'calm', 'dramatic', 'playful', 'lofi'];

/**
 * Music that costs nothing.
 *
 * Licensing a catalogue is either expensive or forbidden — most free libraries
 * explicitly disallow re-hosting their files inside another app. These beds are
 * generated in the browser from oscillators, so they are free to use, identical
 * on every machine, and take up no storage anywhere.
 */
export function MusicPanel() {
  const { t } = useI18n();
  const [mood, setMood] = useState<MusicMood | 'all'>('all');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef(new Map<string, string>());

  const dispatch = useEditorStore((s) => s.dispatch);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const preview = useCallback(
    async (id: string) => {
      if (playingId === id) {
        stop();
        return;
      }
      setPreviewing(id);
      try {
        let url = urlCache.current.get(id);
        if (!url) {
          url = URL.createObjectURL(await renderMusic(id));
          urlCache.current.set(id, url);
        }
        stop();
        const audio = new Audio(url);
        audio.loop = true;
        audio.volume = 0.6;
        audio.onended = () => setPlayingId(null);
        audioRef.current = audio;
        await audio.play();
        setPlayingId(id);
      } catch {
        setPlayingId(null);
      } finally {
        setPreviewing(null);
      }
    },
    [playingId, stop],
  );

  const add = useCallback(
    (id: string) => {
      const store = useEditorStore.getState();
      const duration = Math.max(16, timelineDuration(store.state));
      dispatch([{ type: 'add_music', params: { bed: id, start: 0, duration } }], {
        label: `Add ${id.replace(/_/g, ' ')}`,
      });
    },
    [dispatch],
  );

  const visible = MUSIC_LIBRARY.filter((bed) => mood === 'all' || bed.mood === mood);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-3 py-2">
        {MOODS.map((id) => (
          <button
            key={id}
            onClick={() => setMood(id)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10.5px] transition-colors',
              mood === id ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:text-ink',
            )}
          >
            {t(`music.mood.${id}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">{t('editor.musicHint')}</p>
        <div className="space-y-1.5">
          {visible.map((bed) => (
            <div
              key={bed.id}
              className="group flex items-center gap-2 rounded-md border border-line bg-base px-2 py-1.5 transition-colors hover:border-line-strong"
            >
              <button
                onClick={() => void preview(bed.id)}
                aria-label={t('editor.play')}
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-sm transition-colors',
                  playingId === bed.id ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:text-ink',
                )}
              >
                {previewing === bed.id ? (
                  <Loader2 size={12} className="animate-spin-slow" />
                ) : playingId === bed.id ? (
                  <Square size={11} />
                ) : (
                  <Play size={12} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-ink">{t(`music.${bed.id}` as Parameters<typeof t>[0])}</p>
                <p className="truncate text-[10.5px] text-ink-faint">
                  {bed.bpm} BPM · {t(`music.${bed.id}.about` as Parameters<typeof t>[0])}
                </p>
              </div>
              <button
                onClick={() => add(bed.id)}
                aria-label={t('editor.addMusic')}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition-all group-hover:opacity-100 hover:bg-elevated hover:text-ink focus:opacity-100"
              >
                <Plus size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
