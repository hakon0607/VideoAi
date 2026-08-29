'use client';

import { useEffect, useState } from 'react';
import { Maximize2, Pause, Play, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { timelineDuration } from '@/lib/editor/selectors';
import { formatTimecode } from '@/lib/editor/time';
import { useT } from '@/lib/i18n/context';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export function Transport({
  masterVolume,
  onVolume,
  muted,
  onMuted,
}: {
  masterVolume: number;
  onVolume: (value: number) => void;
  muted: boolean;
  onMuted: (value: boolean) => void;
}) {
  const t = useT();
  const playing = useEditorStore((s) => s.playing);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const fps = useEditorStore((s) => s.state.settings.fps);
  // Seeded from the store and then updated only from its subscription, so a
  // 60 fps playhead re-renders this bar and nothing else.
  const [playhead, setLocalPlayhead] = useState(() => useEditorStore.getState().playhead);
  const [duration, setDuration] = useState(() => timelineDuration(useEditorStore.getState().state));
  const [speed, setSpeed] = useState(1);

  useEffect(
    () =>
      useEditorStore.subscribe((store, prev) => {
        if (store.playhead !== prev.playhead) setLocalPlayhead(store.playhead);
        if (store.state !== prev.state) setDuration(timelineDuration(store.state));
      }),
    [],
  );

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-surface px-3">
      <Tooltip label={playing ? t('editor.pause') : t('editor.play')} shortcut="Space" side="top">
        <button
          onClick={() => setPlaying(!playing)}
          className="grid h-8 w-8 place-items-center rounded-md bg-raised text-ink transition-colors hover:bg-line"
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
        </button>
      </Tooltip>

      <Tooltip label={t('editor.stop')} side="top">
        <button
          onClick={() => {
            setPlaying(false);
            setPlayhead(0);
          }}
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <Square size={12} />
        </button>
      </Tooltip>

      <div className="flex items-center">
        <Tooltip label="−1 frame" shortcut="←" side="top">
          <button
            onClick={() => setPlayhead(playhead - 1 / fps)}
            className="grid h-8 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:text-ink"
          >
            <SkipBack size={12} />
          </button>
        </Tooltip>
        <Tooltip label="+1 frame" shortcut="→" side="top">
          <button
            onClick={() => setPlayhead(playhead + 1 / fps)}
            className="grid h-8 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:text-ink"
          >
            <SkipForward size={12} />
          </button>
        </Tooltip>
      </div>

      <span className="ml-1 font-mono text-[12px] tabular-nums text-ink">
        {formatTimecode(playhead, fps)}
        <span className="text-ink-faint"> / {formatTimecode(duration, fps)}</span>
      </span>

      <div className="flex-1" />

      <select
        value={speed}
        onChange={(e) => {
          const value = Number(e.target.value);
          setSpeed(value);
          // Playback speed is a preview convenience; it never touches the project.
          document.querySelectorAll('video, audio').forEach((el) => {
            (el as HTMLMediaElement).defaultPlaybackRate = value;
          });
        }}
        className="h-7 rounded-sm border border-line bg-base px-1.5 text-[11.5px] text-ink-muted"
        aria-label={t('editor.speed')}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <Tooltip label={muted ? t('editor.unmute') : t('editor.mute')} side="top">
          <button
            onClick={() => onMuted(!muted)}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-sm transition-colors hover:text-ink',
              muted ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </Tooltip>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="w-20"
          aria-label={t('editor.volume')}
        />
      </div>

      <Tooltip label={t('editor.fullscreen')} side="top">
        <button
          onClick={() => {
            const el = document.getElementById('videoai-preview-shell');
            if (el?.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
          }}
          className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:text-ink"
        >
          <Maximize2 size={13} />
        </button>
      </Tooltip>
    </div>
  );
}
