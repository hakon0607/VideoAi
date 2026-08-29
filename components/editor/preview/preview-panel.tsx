'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  const clips = useEditorStore((s) => s.state.clips);
  const settings = useEditorStore((s) => s.state.settings);
  const playing = useEditorStore((s) => s.playing);
  const urls = useMediaUrls((s) => s.urls);

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
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    composeFrame(ctx, store.state, store.playhead, pool);
    ctx.restore();
  }, [scale, pool]);

  // The render loop. While playing it also advances the playhead from the wall
  // clock, so audio and picture stay locked to real time rather than to frames.
  useEffect(() => {
    if (!pool) return;

    const tick = (now: number) => {
      const store = useEditorStore.getState();
      if (store.playing) {
        const delta = lastTickRef.current ? (now - lastTickRef.current) / 1000 : 0;
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
            className="h-full max-h-full w-full max-w-full rounded-md border border-line bg-black object-contain shadow-panel"
            style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
          />
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
