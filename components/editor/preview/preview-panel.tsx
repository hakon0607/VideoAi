'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { MediaPool } from '@/lib/render/media-pool';
import { composeFrame } from '@/lib/render/compose';
import { timelineDuration } from '@/lib/editor/selectors';
import { Transport } from './transport';
import { useT } from '@/lib/i18n/context';

/** Preview never renders above this long edge; export always uses full size. */
const MAX_PREVIEW_EDGE = 1440;

export function PreviewPanel({
  onCaptureReady,
}: {
  onCaptureReady?: (capture: () => Promise<Blob | null>) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Created once, lazily, so the server render never touches DOM APIs.
  const [pool] = useState<MediaPool | null>(() => (typeof window === 'undefined' ? null : new MediaPool()));
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const [masterVolume, setMasterVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // While dragging in the preview the move is drawn from this ref rather than
  // committed to the store, so a drag is one undoable change, not sixty.
  const previewDrag = useRef<{ clipId: string; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clips = useEditorStore((s) => s.state.clips);
  const settings = useEditorStore((s) => s.state.settings);
  const playing = useEditorStore((s) => s.playing);
  const urls = useMediaUrls((s) => s.urls);
  const selectedVisual = useEditorStore((s) =>
    s.state.clips.some((c) => s.selection.clipIds.includes(c.id) && c.kind !== 'audio' && !c.locked),
  );

  const { renderWidth, renderHeight, scale } = useMemo(() => {
    const factor = Math.min(1, MAX_PREVIEW_EDGE / Math.max(settings.width, settings.height));
    return {
      renderWidth: Math.round(settings.width * factor),
      renderHeight: Math.round(settings.height * factor),
      scale: factor,
    };
  }, [settings.width, settings.height]);

  // Keep the media elements in sync with the timeline and the signed URLs.
  useEffect(() => {
    if (!pool) return;
    pool.setUrls(new Map(Object.entries(urls)));
    pool.sync(clips);
  }, [clips, urls, pool]);

  useEffect(() => {
    pool?.setMasterVolume(masterVolume, muted);
  }, [masterVolume, muted, pool]);

  useEffect(() => () => pool?.destroy(), [pool]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pool) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const store = useEditorStore.getState();

    const drag = previewDrag.current;
    const drawState: EditorState = drag
      ? {
          ...store.state,
          clips: store.state.clips.map((clip) =>
            clip.id === drag.clipId
              ? { ...clip, transform: { ...clip.transform, x: drag.x, y: drag.y } }
              : clip,
          ),
        }
      : store.state;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    composeFrame(ctx, drawState, store.playhead, pool);
    ctx.restore();
  }, [scale, pool]);

  // The render loop. While playing it also advances the playhead from the wall
  // clock, so audio and picture stay locked to real time rather than to frames.
  useEffect(() => {
    if (!pool) return;

    const tick = (now: number) => {
      const store = useEditorStore.getState();
      pool.setPlaybackRate(store.previewRate);
      if (store.playing) {
        // The playhead advances at the chosen speed, so picture, audio and the
        // timecode all agree at 0.5x and 2x.
        const delta = lastTickRef.current ? ((now - lastTickRef.current) / 1000) * store.previewRate : 0;
        const duration = timelineDuration(store.state);
        const next = store.playhead + delta;
        if (duration > 0 && next >= duration) {
          store.setPlayhead(duration);
          store.setPlaying(false);
          pool.pauseAll();
        } else {
          store.setPlayhead(next);
        }
      }
      lastTickRef.current = now;
      pool.update(store.state, store.playhead, store.playing);
      draw();
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      lastTickRef.current = 0;
    };
  }, [draw, pool]);

  useEffect(() => {
    if (!playing) pool?.pauseAll();
  }, [playing, pool]);

  // Thumbnail capture for the dashboard card.
  useEffect(() => {
    if (!onCaptureReady) return;
    onCaptureReady(async () => {
      const canvas = canvasRef.current;
      if (!canvas || !pool) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const store = useEditorStore.getState();
      const target = Math.min(1, timelineDuration(store.state) * 0.15);
      pool.update(store.state, target, false);
      await new Promise((resolve) => setTimeout(resolve, 250));
      ctx.save();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      composeFrame(ctx, store.state, target, pool);
      ctx.restore();
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
    });
  }, [onCaptureReady, scale, pool]);

  /**
   * Dragging inside the preview moves the selected clip, which is how people
   * expect to reframe a shot. Shift constrains to one axis.
   */
  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const store = useEditorStore.getState();
      const clip = store.state.clips.find(
        (c) => store.selection.clipIds.includes(c.id) && c.kind !== 'audio' && !c.locked,
      );
      if (!clip) return;

      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      setDragging(true);

      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: clip.transform.x, y: clip.transform.y };

      const onMove = (e: PointerEvent) => {
        // Pointer pixels are canvas pixels are frame fractions.
        let dx = (e.clientX - startX) / rect.width;
        let dy = (e.clientY - startY) / rect.height;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        previewDrag.current = {
          clipId: clip.id,
          x: Math.max(-2, Math.min(2, origin.x + dx)),
          y: Math.max(-2, Math.min(2, origin.y + dy)),
        };
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDragging(false);
        const final = previewDrag.current;
        previewDrag.current = null;
        if (!final) return;
        if (Math.abs(final.x - origin.x) < 0.001 && Math.abs(final.y - origin.y) < 0.001) return;
        store.dispatch(
          [{ type: 'set_transform', params: { clipId: clip.id, x: final.x, y: final.y } }],
          { label: 'Move clip in frame' },
        );
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-base">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          className="relative max-h-full max-w-full"
          style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
        >
          <canvas
            ref={canvasRef}
            width={renderWidth}
            height={renderHeight}
            onPointerDown={onCanvasPointerDown}
            className={`h-full max-h-full w-full max-w-full rounded-md border border-line bg-black object-contain shadow-panel ${
              selectedVisual ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
            }`}
            style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
          />
          {selectedVisual && !dragging && (
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm bg-black/65 px-2 py-1 text-[10.5px] text-white/80 backdrop-blur-sm">
              {t('editor.dragInPreview')}
            </span>
          )}
          {clips.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="text-[12.5px] text-ink-faint">{t('editor.emptyTimeline')}</p>
            </div>
          )}
        </div>
      </div>
      <Transport masterVolume={masterVolume} onVolume={setMasterVolume} muted={muted} onMuted={setMuted} />
    </section>
  );
}
