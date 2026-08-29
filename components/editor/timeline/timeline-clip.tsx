'use client';

import { memo } from 'react';
import { Lock, Music, Type as TypeIcon, Image as ImageIcon, Film } from 'lucide-react';
import type { Clip, MediaAsset } from '@/types/editor';
import { cn } from '@/lib/utils/cn';
import { clipColor } from './timeline-utils';

const ICONS = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: TypeIcon,
} as const;

export interface TimelineClipProps {
  clip: Clip;
  asset: MediaAsset | undefined;
  left: number;
  width: number;
  height: number;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (event: React.PointerEvent, clip: Clip, mode: 'move' | 'trim-start' | 'trim-end') => void;
}

function Waveform({ peaks, width, height }: { peaks: number[]; width: number; height: number }) {
  if (!peaks.length || width < 8) return null;
  const step = Math.max(1, Math.floor(peaks.length / Math.max(1, Math.floor(width / 2))));
  const points: string[] = [];
  for (let i = 0; i < peaks.length; i += step) {
    const x = (i / peaks.length) * width;
    const amplitude = Math.min(1, peaks[i]) * (height / 2 - 2);
    points.push(`M${x.toFixed(1)},${(height / 2 - amplitude).toFixed(1)}V${(height / 2 + amplitude).toFixed(1)}`);
  }
  return (
    <svg width={width} height={height} className="pointer-events-none absolute inset-0 opacity-45" aria-hidden>
      <path d={points.join('')} stroke="currentColor" strokeWidth={1} fill="none" />
    </svg>
  );
}

export const TimelineClip = memo(function TimelineClip({
  clip,
  asset,
  left,
  width,
  height,
  selected,
  dragging,
  onPointerDown,
}: TimelineClipProps) {
  const Icon = ICONS[clip.kind];
  const colour = clipColor(clip);
  const showHandles = width > 26 && !clip.locked;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onPointerDown={(e) => onPointerDown(e, clip, 'move')}
      className={cn(
        'group absolute top-0 overflow-hidden rounded-sm border text-left select-none',
        'transition-shadow duration-100',
        selected ? 'border-ink ring-1 ring-ink/70' : 'border-black/40',
        dragging ? 'opacity-80 shadow-pop' : '',
        clip.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        left,
        width: Math.max(3, width),
        height,
        background: `color-mix(in srgb, ${colour} 24%, var(--color-elevated))`,
        color: colour,
      }}
      title={clip.name}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: colour }}
      />
      {clip.kind === 'audio' && asset?.waveform && (
        <Waveform peaks={asset.waveform} width={Math.max(3, width)} height={height} />
      )}

      {width > 44 && (
        <div className="pointer-events-none relative flex h-full items-start gap-1 px-2 py-1">
          <Icon size={10} className="mt-px shrink-0 opacity-80" />
          <span className="truncate text-[10.5px] font-medium text-ink/90">{clip.name}</span>
          {clip.locked && <Lock size={9} className="ml-auto shrink-0 opacity-70" />}
        </div>
      )}

      {(clip.transitionIn || clip.transitionOut) && (
        <>
          {clip.transitionIn && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 bg-linear-to-r from-white/30 to-transparent"
              style={{ width: Math.min(width / 2, 22) }}
            />
          )}
          {clip.transitionOut && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 bg-linear-to-l from-white/30 to-transparent"
              style={{ width: Math.min(width / 2, 22) }}
            />
          )}
        </>
      )}

      {showHandles && (
        <>
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, clip, 'trim-start');
            }}
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.35), transparent)' }}
          />
          <span
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, clip, 'trim-end');
            }}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: 'linear-gradient(to left, rgba(255,255,255,0.35), transparent)' }}
          />
        </>
      )}
    </div>
  );
});
