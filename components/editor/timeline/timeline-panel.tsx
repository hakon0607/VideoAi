'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Plus,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Clip, Track, TrackKind } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { clipEnd, formatTimecode, q } from '@/lib/editor/time';
import { clipsOnTrack, orderedTracks, timelineDuration } from '@/lib/editor/selectors';
import { clipFitsTrack } from '@/lib/editor/defaults';
import { useT } from '@/lib/i18n/context';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { TimelineClip } from './timeline-clip';
import { RULER_HEIGHT, TRACK_GAP, TRACK_HEADER_WIDTH, snapTargets, snapTime, tickInterval } from './timeline-utils';

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  originClientX: number;
  originStart: number;
  originEnd: number;
  originTrackId: string;
  currentStart: number;
  currentEnd: number;
  currentTrackId: string;
  moved: boolean;
}

const TRACK_KIND_COLORS: Record<TrackKind, string> = {
  video: 'var(--color-track-video)',
  audio: 'var(--color-track-audio)',
  text: 'var(--color-track-text)',
  overlay: 'var(--color-track-overlay)',
};

export function TimelinePanel() {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const state = useEditorStore((s) => s.state);
  const selection = useEditorStore((s) => s.selection);
  const pixelsPerSecond = useEditorStore((s) => s.pixelsPerSecond);
  const setPixelsPerSecond = useEditorStore((s) => s.setPixelsPerSecond);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const select = useEditorStore((s) => s.select);
  const dispatch = useEditorStore((s) => s.dispatch);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const tracks = useMemo(() => orderedTracks(state), [state]);
  const duration = useMemo(() => timelineDuration(state), [state]);
  const contentWidth = Math.max(600, (duration + 8) * pixelsPerSecond);
  const ticks = tickInterval(pixelsPerSecond);

  // Playhead position is written straight to the DOM so 60 fps playback never
  // re-renders the timeline tree.
  useEffect(() => {
    const apply = (time: number) => {
      const el = playheadRef.current;
      if (el) el.style.transform = `translateX(${time * pixelsPerSecond}px)`;
    };
    apply(useEditorStore.getState().playhead);
    return useEditorStore.subscribe((store, prev) => {
      if (store.playhead !== prev.playhead) apply(store.playhead);
    });
  }, [pixelsPerSecond]);

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const lanes = lanesRef.current;
      if (!lanes) return 0;
      const rect = lanes.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left) / pixelsPerSecond);
    },
    [pixelsPerSecond],
  );

  /* ---------------------------------------------------------------------- */
  /* Scrubbing                                                              */
  /* ---------------------------------------------------------------------- */
  const scrub = useCallback(
    (event: React.PointerEvent) => {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setPlayhead(timeFromEvent(event.clientX));
      const onMove = (e: PointerEvent) => setPlayhead(timeFromEvent(e.clientX));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setPlayhead, timeFromEvent],
  );

  /* ---------------------------------------------------------------------- */
  /* Clip drag / trim                                                       */
  /* ---------------------------------------------------------------------- */
  const onClipPointerDown = useCallback(
    (event: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
      event.preventDefault();
      if (event.shiftKey) {
        useEditorStore.getState().toggleSelect(clip.id);
      } else if (!selection.clipIds.includes(clip.id)) {
        select([clip.id], clip.trackId);
      }
      if (clip.locked) return;

      setDrag({
        mode,
        clipId: clip.id,
        originClientX: event.clientX,
        originStart: clip.start,
        originEnd: clipEnd(clip),
        originTrackId: clip.trackId,
        currentStart: clip.start,
        currentEnd: clipEnd(clip),
        currentTrackId: clip.trackId,
        moved: false,
      });
    },
    [select, selection.clipIds],
  );

  useEffect(() => {
    if (!drag) return;
    const targets = snapTargets(state, useEditorStore.getState().playhead, new Set([drag.clipId]));

    const onMove = (event: PointerEvent) => {
      const deltaSeconds = (event.clientX - drag.originClientX) / pixelsPerSecond;
      if (Math.abs(event.clientX - drag.originClientX) < 3 && drag.mode === 'move' && !drag.moved) return;

      if (drag.mode === 'move') {
        const raw = Math.max(0, drag.originStart + deltaSeconds);
        const snappedStart = snapTime(raw, targets, pixelsPerSecond);
        const snappedEnd = snapTime(raw + (drag.originEnd - drag.originStart), targets, pixelsPerSecond);
        // Snap whichever edge is closer to a target.
        const useEnd =
          snappedEnd.snappedTo !== null &&
          (snappedStart.snappedTo === null ||
            Math.abs(snappedEnd.time - (raw + (drag.originEnd - drag.originStart))) < Math.abs(snappedStart.time - raw));
        const start = useEnd ? snappedEnd.time - (drag.originEnd - drag.originStart) : snappedStart.time;
        setSnapLine(useEnd ? snappedEnd.snappedTo : snappedStart.snappedTo);

        // Which track is the pointer over?
        let trackId = drag.currentTrackId;
        const lanes = lanesRef.current;
        if (lanes) {
          const rect = lanes.getBoundingClientRect();
          let offset = event.clientY - rect.top;
          for (const track of tracks) {
            if (offset <= track.height) {
              const clip = state.clips.find((c) => c.id === drag.clipId);
              if (clip && clipFitsTrack(clip.kind, track.kind) && !track.locked) trackId = track.id;
              break;
            }
            offset -= track.height + TRACK_GAP;
          }
        }

        setDrag((d) =>
          d
            ? {
                ...d,
                moved: true,
                currentStart: Math.max(0, start),
                currentEnd: Math.max(0, start) + (d.originEnd - d.originStart),
                currentTrackId: trackId,
              }
            : d,
        );
        return;
      }

      if (drag.mode === 'trim-start') {
        const raw = Math.min(drag.originEnd - 0.05, Math.max(0, drag.originStart + deltaSeconds));
        const snapped = snapTime(raw, targets, pixelsPerSecond);
        setSnapLine(snapped.snappedTo);
        setDrag((d) => (d ? { ...d, moved: true, currentStart: snapped.time } : d));
        return;
      }

      const raw = Math.max(drag.originStart + 0.05, drag.originEnd + deltaSeconds);
      const snapped = snapTime(raw, targets, pixelsPerSecond);
      setSnapLine(snapped.snappedTo);
      setDrag((d) => (d ? { ...d, moved: true, currentEnd: snapped.time } : d));
    };

    const onUp = () => {
      setSnapLine(null);
      setDrag((current) => {
        if (!current || !current.moved) return null;
        if (current.mode === 'move') {
          dispatch(
            [
              {
                type: 'move_clip',
                params: {
                  clipId: current.clipId,
                  start: q(current.currentStart),
                  ...(current.currentTrackId !== current.originTrackId ? { trackId: current.currentTrackId } : {}),
                },
              },
            ],
            { label: 'Move clip' },
          );
        } else {
          dispatch(
            [
              {
                type: 'trim_clip',
                params:
                  current.mode === 'trim-start'
                    ? { clipId: current.clipId, start: q(current.currentStart) }
                    : { clipId: current.clipId, end: q(current.currentEnd) },
              },
            ],
            { label: 'Trim clip' },
          );
        }
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, dispatch, pixelsPerSecond, state, tracks]);

  /* ---------------------------------------------------------------------- */
  /* Toolbar actions                                                        */
  /* ---------------------------------------------------------------------- */
  const splitAtPlayhead = useCallback(() => {
    const store = useEditorStore.getState();
    const time = store.playhead;
    const candidates = store.selection.clipIds.length
      ? store.state.clips.filter((c) => store.selection.clipIds.includes(c.id))
      : store.state.clips;
    const target = candidates.find((c) => time > c.start + 0.03 && time < clipEnd(c) - 0.03);
    if (!target) return;
    dispatch([{ type: 'split_clip', params: { clipId: target.id, time } }], { label: 'Split clip' });
  }, [dispatch]);

  const deleteSelection = useCallback(() => {
    const ids = useEditorStore.getState().selection.clipIds;
    if (!ids.length) return;
    dispatch([{ type: 'delete_clips', params: { clipIds: ids } }], { label: 'Delete clips' });
  }, [dispatch]);

  const addTrack = useCallback(
    (kind: TrackKind) => {
      setAddOpen(false);
      dispatch([{ type: 'create_track', params: { kind } }], { label: `Add ${kind} track` });
    },
    [dispatch],
  );

  const setTrackFlag = useCallback(
    (track: Track, patch: Record<string, boolean>) => {
      dispatch([{ type: 'set_track_properties', params: { trackId: track.id, ...patch } }], {
        label: 'Update track',
      });
    },
    [dispatch],
  );

  return (
    <section className="flex min-h-0 flex-col border-t border-line bg-surface">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <Tooltip label={t('editor.split')} shortcut="S" side="top">
          <button
            onClick={splitAtPlayhead}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Scissors size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.deleteClip')} shortcut="Del" side="top">
          <button
            onClick={deleteSelection}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </Tooltip>

        <span className="mx-1 h-4 w-px bg-line" />

        <div className="relative">
          <Tooltip label={t('editor.addTrack')} side="top">
            <button
              onClick={() => setAddOpen((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <Plus size={13} />
            </button>
          </Tooltip>
          {addOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 w-36 rounded-md border border-line bg-surface p-1 shadow-pop">
                {(['video', 'audio', 'text', 'overlay'] as TrackKind[]).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => addTrack(kind)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-ink-muted capitalize transition-colors hover:bg-elevated hover:text-ink"
                  >
                    <span className="h-2 w-2 rounded-xs" style={{ background: TRACK_KIND_COLORS[kind] }} />
                    {kind}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        <span className="mr-1 font-mono text-[11px] text-ink-faint tabular-nums">
          {formatTimecode(duration, state.settings.fps)}
        </span>
        <Tooltip label={t('editor.zoomOut')} shortcut="⌘−" side="top">
          <button
            onClick={() => setPixelsPerSecond(pixelsPerSecond / 1.4)}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ZoomOut size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.zoomIn')} shortcut="⌘+" side="top">
          <button
            onClick={() => setPixelsPerSecond(pixelsPerSecond * 1.4)}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ZoomIn size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.fit')} side="top">
          <button
            onClick={() => {
              const width = scrollRef.current?.clientWidth ?? 900;
              setPixelsPerSecond(Math.max(4, (width - TRACK_HEADER_WIDTH - 40) / Math.max(1, duration)));
            }}
            className="h-7 rounded-sm px-2 text-[11.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            {t('editor.fit')}
          </button>
        </Tooltip>
      </div>

      {/* Ruler, pinned above the vertically scrolling lanes */}
      <div className="flex shrink-0 border-b border-line bg-base">
        <div className="shrink-0 border-r border-line" style={{ width: TRACK_HEADER_WIDTH, height: RULER_HEIGHT }} />
        <div ref={rulerRef} className="min-w-0 flex-1 overflow-hidden">
          <div onPointerDown={scrub} className="cursor-ew-resize" style={{ width: contentWidth, height: RULER_HEIGHT }}>
            <svg width={contentWidth} height={RULER_HEIGHT} className="block">
              {Array.from({ length: Math.ceil(contentWidth / (ticks.major * pixelsPerSecond)) + 1 }, (_, i) => {
                const time = i * ticks.major;
                const x = time * pixelsPerSecond;
                return (
                  <g key={i}>
                    <line x1={x} y1={RULER_HEIGHT - 8} x2={x} y2={RULER_HEIGHT} stroke="var(--color-line-strong)" />
                    <text x={x + 4} y={12} fill="var(--color-ink-faint)" fontSize={9.5} fontFamily="var(--font-mono)">
                      {formatTimecode(time, state.settings.fps)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {/* Track headers */}
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-base" style={{ width: TRACK_HEADER_WIDTH }}>
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-1.5 border-b border-line/60 px-2"
              style={{ height: track.height, marginBottom: TRACK_GAP }}
            >
              <span className="h-6 w-[3px] shrink-0 rounded-xs" style={{ background: TRACK_KIND_COLORS[track.kind] }} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">{track.name}</span>
              <button
                onClick={() => setTrackFlag(track, { muted: !track.muted })}
                className={cn('rounded-xs p-1 transition-colors hover:text-ink', track.muted ? 'text-danger' : 'text-ink-faint')}
                title={track.muted ? t('editor.unmute') : t('editor.mute')}
              >
                {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              </button>
              {track.kind !== 'audio' && (
                <button
                  onClick={() => setTrackFlag(track, { hidden: !track.hidden })}
                  className={cn('rounded-xs p-1 transition-colors hover:text-ink', track.hidden ? 'text-warning' : 'text-ink-faint')}
                  title={t('editor.trackHidden')}
                >
                  {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
              )}
              <button
                onClick={() => setTrackFlag(track, { locked: !track.locked })}
                className={cn('rounded-xs p-1 transition-colors hover:text-ink', track.locked ? 'text-warning' : 'text-ink-faint')}
                title={t('editor.trackLocked')}
              >
                {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
            </div>
          ))}
        </div>

        {/* Lanes */}
        <div
          ref={scrollRef}
          onScroll={(event) => {
            if (rulerRef.current) rulerRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          className="min-w-0 flex-1 overflow-x-auto"
        >
          <div ref={lanesRef} className="relative" style={{ width: contentWidth }} onPointerDown={(e) => e.target === e.currentTarget && select([])}>
            {tracks.map((track) => {
              const trackClips = clipsOnTrack(state, track.id);
              return (
                <div
                  key={track.id}
                  className={cn(
                    'relative border-b border-line/50',
                    track.hidden ? 'opacity-45' : '',
                    drag?.currentTrackId === track.id ? 'bg-accent-soft' : 'bg-base/40',
                  )}
                  style={{ height: track.height, marginBottom: TRACK_GAP }}
                >
                  {trackClips.map((clip) => {
                    const isDragged = drag?.clipId === clip.id;
                    const start = isDragged ? drag.currentStart : clip.start;
                    const end = isDragged ? drag.currentEnd : clipEnd(clip);
                    if (isDragged && drag.currentTrackId !== track.id) return null;
                    return (
                      <TimelineClip
                        key={clip.id}
                        clip={clip}
                        asset={state.assets.find((a) => 'assetId' in clip && a.id === clip.assetId)}
                        left={start * pixelsPerSecond}
                        width={(end - start) * pixelsPerSecond}
                        height={track.height}
                        selected={selection.clipIds.includes(clip.id)}
                        dragging={isDragged}
                        onPointerDown={onClipPointerDown}
                      />
                    );
                  })}
                  {drag && drag.currentTrackId === track.id && drag.originTrackId !== track.id && (
                    <div
                      className="pointer-events-none absolute top-0 rounded-sm border border-dashed border-ink/60"
                      style={{
                        left: drag.currentStart * pixelsPerSecond,
                        width: (drag.currentEnd - drag.currentStart) * pixelsPerSecond,
                        height: track.height,
                      }}
                    />
                  )}
                </div>
              );
            })}

            {state.clips.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <p className="text-[12.5px] text-ink-faint">{t('editor.emptyTimeline')}</p>
              </div>
            )}

            {snapLine !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-accent"
                style={{ left: snapLine * pixelsPerSecond }}
              />
            )}

            <div
              ref={playheadRef}
              className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-ink will-change-transform"
              style={{ left: 0 }}
            >
              <span className="absolute -top-0.5 -left-[5px] h-2.5 w-2.5 rotate-45 rounded-xs bg-ink" />
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}
