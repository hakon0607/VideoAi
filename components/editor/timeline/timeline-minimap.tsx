'use client';

import { memo, useCallback, useEffect, useRef } from 'react';
import type { EditorState } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { useT } from '@/lib/i18n/context';
import { clipColor } from './timeline-utils';

const HEIGHT = 26;

/**
 * A whole-timeline overview with a draggable viewport window.
 *
 * At the zoom level a two-hour recording needs, the visible window is a couple
 * of percent of the project. Without an overview you lose your place; with one
 * you can see the shape of the edit and jump anywhere in a single drag.
 */
export const TimelineMinimap = memo(function TimelineMinimap({
  state,
  duration,
  viewportStart,
  viewportEnd,
  playhead,
  onScrubViewport,
}: {
  state: EditorState;
  duration: number;
  viewportStart: number;
  viewportEnd: number;
  playhead: number;
  /** Called with the time that should sit at the centre of the viewport. */
  onScrubViewport: (centreTime: number) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const total = Math.max(duration, 0.001);

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * total;
    },
    [total],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      onScrubViewport(timeFromEvent(event.clientX));
      const onMove = (e: PointerEvent) => onScrubViewport(timeFromEvent(e.clientX));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [onScrubViewport, timeFromEvent],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The overview is drawn on a canvas rather than as one element per clip: an
  // hour-long edit is easily a thousand clips, and a thousand DOM nodes make
  // every zoom step and every edit re-layout the whole strip.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? 0);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas cannot resolve `var(--…)`, so the theme colours are read once from
    // the stylesheet and passed as real values.
    const styles = getComputedStyle(document.documentElement);
    const colourFor = (clip: (typeof state.clips)[number]) => {
      const name = clipColor(clip).match(/var\((--[^)]+)\)/)?.[1];
      const resolved = name ? styles.getPropertyValue(name).trim() : '';
      return resolved || '#6d6aff';
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const rows = [...state.tracks].sort((a, b) => a.index - b.index);
    const rowHeight = Math.max(2, Math.floor((HEIGHT - 4) / Math.max(1, rows.length)));
    const rowOf = new Map(rows.map((track, index) => [track.id, index]));

    ctx.globalAlpha = 0.65;
    for (const clip of state.clips) {
      const row = rowOf.get(clip.trackId);
      if (row === undefined) continue;
      const x = (clip.start / total) * width;
      const w = Math.max(1, ((clipEnd(clip) - clip.start) / total) * width);
      ctx.fillStyle = colourFor(clip);
      ctx.fillRect(x, 2 + row * rowHeight, w, rowHeight - 1);
    }
    ctx.globalAlpha = 1;
  }, [state, total]);

  const windowLeft = `${Math.max(0, (viewportStart / total) * 100)}%`;
  const windowWidth = `${Math.min(100, ((viewportEnd - viewportStart) / total) * 100)}%`;
  const covered = viewportEnd - viewportStart >= total - 0.01;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className="relative shrink-0 cursor-pointer overflow-hidden border-b border-line bg-base"
      style={{ height: HEIGHT }}
      role="slider"
      tabIndex={0}
      aria-label={t('editor.timelineOverview')}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(viewportStart)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <span
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink"
        style={{ left: `${(playhead / total) * 100}%` }}
      />

      {!covered && (
        <span
          className="pointer-events-none absolute top-0 bottom-0 rounded-xs border border-ink/70 bg-ink/10"
          style={{ left: windowLeft, width: windowWidth }}
        />
      )}
    </div>
  );
});
