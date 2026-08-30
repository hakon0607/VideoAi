'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Hand,
  Lock,
  Magnet,
  Plus,
  Rewind,
  Scissors,
  Snowflake,
  SquareSplitHorizontal,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Clip, MediaClip, Track, TrackKind } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { clipEnd, formatClockTime, q } from '@/lib/editor/time';
import { clipsOnTrack, orderedTracks, timelineDuration } from '@/lib/editor/selectors';
import { clipFitsTrack } from '@/lib/editor/defaults';
import { useT } from '@/lib/i18n/context';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { TimelineClip } from './timeline-clip';
import { TimelineMinimap } from './timeline-minimap';
import { MEDIA_DRAG_TYPE, readMediaDrag } from './drag-payload';
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
  const setZoomFloor = useEditorStore((s) => s.setZoomFloor);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const select = useEditorStore((s) => s.select);
  const dispatch = useEditorStore((s) => s.dispatch);

  const [drag, setDrag] = useState<DragState | null>(null);
  // The pointer-up handler needs the final drag position, but a state updater
  // must stay pure: React can re-run it during a later render, which would
  // dispatch the edit a second time. So the live value is mirrored here.
  const dragRef = useRef<DragState | null>(null);
  /** Writes the drag to both the ref and the state, keeping them in step. */
  const applyDrag = useCallback(
    (next: DragState | null | ((current: DragState | null) => DragState | null)) => {
      const value = typeof next === 'function' ? next(dragRef.current) : next;
      dragRef.current = value;
      setDrag(value);
    },
    [],
  );
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 0 });
  const [dropHint, setDropHint] = useState<{ time: number; trackId: string | null } | null>(null);
  const [panning, setPanning] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const markers = state.markers;

  const tracks = useMemo(() => orderedTracks(state), [state]);
  const duration = useMemo(() => timelineDuration(state), [state]);
  const contentWidth = Math.max(600, (duration + 8) * pixelsPerSecond);
  // The slice of the timeline the lanes actually have to draw, with a screen of
  // margin on each side so scrolling never reveals an empty gap.
  const visibleRange = useMemo(() => {
    const width = viewport.width || 900;
    const margin = width / pixelsPerSecond;
    return {
      start: Math.max(0, viewport.scrollLeft / pixelsPerSecond - margin),
      end: (viewport.scrollLeft + width) / pixelsPerSecond + margin,
    };
  }, [viewport.scrollLeft, viewport.width, pixelsPerSecond]);
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

  // The overview needs the playhead too, but it does not need it 60 times a
  // second, so this subscription is throttled well below the frame rate.
  useEffect(() => {
    let last = 0;
    return useEditorStore.subscribe((store, prev) => {
      if (store.playhead === prev.playhead) return;
      const now = performance.now();
      if (now - last < 120) return;
      last = now;
      setPlayheadTime(store.playhead);
    });
  }, []);

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
  /* Viewport, zoom and panning                                             */
  /* ---------------------------------------------------------------------- */
  const syncViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport({ scrollLeft: el.scrollLeft, width: el.clientWidth });
    if (rulerRef.current) rulerRef.current.scrollLeft = el.scrollLeft;
  }, []);

  // Zooming out past twice the fit width only produces empty ruler, so the
  // timeline publishes the floor for its own size. It happens in an effect
  // rather than inside syncViewport, because that also runs from a
  // ResizeObserver — and writing to a shared store from there would be an
  // update to other components in the middle of this one's render.
  useEffect(() => {
    if (viewport.width === 0) return;
    setZoomFloor((viewport.width - 40) / Math.max(1, duration + 8) / 2);
  }, [viewport.width, duration, setZoomFloor]);

  useEffect(() => {
    syncViewport();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncViewport]);

  /** Zooms while keeping the moment under the pointer in the same place. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number) => {
      const el = scrollRef.current;
      const current = useEditorStore.getState().pixelsPerSecond;
      const next = Math.min(600, current * factor);
      if (!el) {
        setPixelsPerSecond(next);
        return;
      }
      const rect = el.getBoundingClientRect();
      const anchorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const timeUnderCursor = (el.scrollLeft + anchorX) / current;
      setPixelsPerSecond(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, timeUnderCursor * next - anchorX);
        syncViewport();
      });
    },
    [setPixelsPerSecond, syncViewport],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      // Ctrl/Cmd + wheel is the universal zoom gesture, and it is also what a
      // trackpad pinch sends.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX);
        return;
      }
      const el = scrollRef.current;
      if (!el) return;
      // Shift+wheel, or a trackpad's horizontal axis, pans along the timeline.
      const horizontal = event.shiftKey ? event.deltaY : event.deltaX;
      if (Math.abs(horizontal) > 0) {
        event.preventDefault();
        el.scrollLeft += horizontal;
        syncViewport();
      }
    },
    [zoomAt, syncViewport],
  );

  /** Middle-drag, or space held, grabs the timeline and slides it. */
  const onPanPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const wantsPan = event.button === 1 || (event.button === 0 && spaceHeld.current);
      if (!wantsPan) return;
      const el = scrollRef.current;
      if (!el) return;
      event.preventDefault();
      setPanning(true);
      const startX = event.clientX;
      const startScroll = el.scrollLeft;

      const onMove = (e: PointerEvent) => {
        el.scrollLeft = startScroll - (e.clientX - startX);
        syncViewport();
      };
      const onUp = () => {
        setPanning(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [syncViewport],
  );

  const spaceHeld = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceHeld.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const centreOn = useCallback(
    (time: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, time * pixelsPerSecond - el.clientWidth / 2);
      syncViewport();
    },
    [pixelsPerSecond, syncViewport],
  );

  const zoomToFit = useCallback(() => {
    const el = scrollRef.current;
    const width = (el?.clientWidth ?? 900) - 40;
    setPixelsPerSecond(width / Math.max(1, duration));
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = 0;
      syncViewport();
    });
  }, [duration, setPixelsPerSecond, syncViewport]);

  /* ---------------------------------------------------------------------- */
  /* Dropping media from the library                                        */
  /* ---------------------------------------------------------------------- */
  const trackAtY = useCallback(
    (clientY: number) => {
      const lanes = lanesRef.current;
      if (!lanes) return null;
      const rect = lanes.getBoundingClientRect();
      let offset = clientY - rect.top;
      for (const track of tracks) {
        if (offset <= track.height) return track;
        offset -= track.height + TRACK_GAP;
      }
      return null;
    },
    [tracks],
  );

  const onDropMedia = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDropHint(null);
      const payload = readMediaDrag(event);
      if (!payload) return;

      const time = Math.max(0, timeFromEvent(event.clientX));
      const targetKind = payload.kind === 'audio' ? 'audio' : 'video';
      const hovered = trackAtY(event.clientY);
      const track =
        hovered && clipFitsTrack(payload.kind, hovered.kind) && !hovered.locked
          ? hovered
          : tracks.find((tr) => tr.kind === targetKind && !tr.locked);

      if (track) {
        dispatch([{ type: 'create_clip', params: { trackId: track.id, assetId: payload.assetId, start: q(time) } }], {
          label: `Add ${payload.name}`,
        });
        return;
      }

      // No compatible track exists yet, so make one and drop onto it.
      const created = dispatch([{ type: 'create_track', params: { kind: targetKind } }], { label: 'Add track' });
      const newTrackId = (created.applied[0]?.action.params as { trackId?: string } | undefined)?.trackId;
      if (!newTrackId) return;
      dispatch([{ type: 'create_clip', params: { trackId: newTrackId, assetId: payload.assetId, start: q(time) } }], {
        label: `Add ${payload.name}`,
      });
    },
    [dispatch, timeFromEvent, trackAtY, tracks],
  );

  const onDragOverLanes = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const hovered = trackAtY(event.clientY);
      setDropHint({ time: Math.max(0, timeFromEvent(event.clientX)), trackId: hovered?.id ?? null });
    },
    [timeFromEvent, trackAtY],
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

      applyDrag({
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
    [applyDrag, select, selection.clipIds],
  );

  useEffect(() => {
    if (!drag) return;
    const targets = snapEnabled
      ? snapTargets(state, useEditorStore.getState().playhead, new Set([drag.clipId]))
      : [];

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

        applyDrag((d) =>
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
        applyDrag((d) => (d ? { ...d, moved: true, currentStart: snapped.time } : d));
        return;
      }

      const raw = Math.max(drag.originStart + 0.05, drag.originEnd + deltaSeconds);
      const snapped = snapTime(raw, targets, pixelsPerSecond);
      setSnapLine(snapped.snappedTo);
      applyDrag((d) => (d ? { ...d, moved: true, currentEnd: snapped.time } : d));
    };

    const onUp = () => {
      setSnapLine(null);
      const current = dragRef.current;
      applyDrag(null);
      if (current && current.moved) {
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
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [applyDrag, drag, dispatch, pixelsPerSecond, snapEnabled, state, tracks]);

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

  /** Every toolbar verb below works on the selection, falling back to the clip
   *  under the playhead so a single click does the obvious thing. */
  const selectedClips = useCallback((): Clip[] => {
    const store = useEditorStore.getState();
    const ids = store.selection.clipIds;
    if (ids.length) return store.state.clips.filter((c) => ids.includes(c.id));
    const time = store.playhead;
    const under = store.state.clips.find((c) => time >= c.start && time < clipEnd(c));
    return under ? [under] : [];
  }, []);

  const rippleDelete = useCallback(() => {
    const targets = selectedClips();
    if (!targets.length) return;
    dispatch(
      targets.map((clip) => ({ type: 'ripple_delete_clip', params: { clipId: clip.id } })),
      { label: 'Ripple delete' },
    );
  }, [dispatch, selectedClips]);

  const duplicateSelection = useCallback(() => {
    const targets = selectedClips();
    if (!targets.length) return;
    dispatch(
      targets.map((clip) => ({ type: 'duplicate_clip', params: { clipId: clip.id } })),
      { label: 'Duplicate clips' },
    );
  }, [dispatch, selectedClips]);

  const trimToPlayhead = useCallback(
    (edge: 'start' | 'end') => {
      const store = useEditorStore.getState();
      const time = store.playhead;
      const targets = selectedClips().filter((c) => time > c.start && time < clipEnd(c));
      if (!targets.length) return;
      dispatch(
        targets.map((clip) => ({
          type: 'trim_clip',
          params: edge === 'start' ? { clipId: clip.id, start: q(time) } : { clipId: clip.id, end: q(time) },
        })),
        { label: 'Trim to playhead' },
      );
    },
    [dispatch, selectedClips],
  );

  const closeGaps = useCallback(() => {
    const store = useEditorStore.getState();
    const trackIds = store.selection.trackId
      ? [store.selection.trackId]
      : store.state.tracks.filter((tr) => !tr.locked).map((tr) => tr.id);
    dispatch(
      trackIds.map((trackId) => ({ type: 'close_gaps', params: { trackId } })),
      { label: 'Close gaps', lenient: true },
    );
  }, [dispatch]);

  const detachAudio = useCallback(() => {
    const store = useEditorStore.getState();
    const targets = selectedClips().filter(
      (c): c is MediaClip => isMediaClip(c) && c.kind === 'video',
    );
    if (!targets.length) return;
    let audioTrack = store.state.tracks.find((tr) => tr.kind === 'audio' && !tr.locked);
    if (!audioTrack) {
      const created = dispatch([{ type: 'create_track', params: { kind: 'audio' } }], { label: 'Add track' });
      const id = (created.applied[0]?.action.params as { trackId?: string } | undefined)?.trackId;
      audioTrack = useEditorStore.getState().state.tracks.find((tr) => tr.id === id);
    }
    if (!audioTrack) return;
    const trackId = audioTrack.id;
    dispatch(
      targets.map((clip) => ({ type: 'detach_audio', params: { clipId: clip.id, trackId } })),
      { label: 'Detach audio', lenient: true },
    );
  }, [dispatch, selectedClips]);

  const toggleFreeze = useCallback(() => {
    const targets = selectedClips().filter((c): c is MediaClip => isMediaClip(c));
    if (!targets.length) return;
    const freeze = !targets[0].freeze;
    dispatch(
      targets.map((clip) => ({ type: 'set_freeze_frame', params: { clipId: clip.id, freeze } })),
      { label: freeze ? 'Freeze frame' : 'Unfreeze' },
    );
  }, [dispatch, selectedClips]);

  const toggleReverse = useCallback(() => {
    const targets = selectedClips().filter((c): c is MediaClip => isMediaClip(c));
    if (!targets.length) return;
    const reversed = !targets[0].reversed;
    dispatch(
      targets.map((clip) => ({ type: 'set_clip_reverse', params: { clipId: clip.id, reversed } })),
      { label: reversed ? 'Reverse clip' : 'Play forward' },
    );
  }, [dispatch, selectedClips]);

  const addMarker = useCallback(() => {
    const store = useEditorStore.getState();
    dispatch([{ type: 'add_marker', params: { time: q(store.playhead) } }], { label: 'Add marker' });
  }, [dispatch]);

  const moveTrack = useCallback(
    (track: Track, direction: -1 | 1) => {
      const ordered = orderedTracks(useEditorStore.getState().state);
      const position = ordered.findIndex((tr) => tr.id === track.id);
      const target = position + direction;
      if (target < 0 || target >= ordered.length) return;
      dispatch([{ type: 'move_track', params: { trackId: track.id, index: target } }], {
        label: 'Reorder track',
      });
    },
    [dispatch],
  );

  const removeTrack = useCallback(
    (track: Track) => {
      dispatch([{ type: 'delete_track', params: { trackId: track.id } }], { label: 'Delete track' });
    },
    [dispatch],
  );

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
        <Tooltip label={t('editor.rippleDelete')} side="top">
          <button
            onClick={rippleDelete}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-danger"
          >
            <SquareSplitHorizontal size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.duplicateClip')} shortcut="⌘D" side="top">
          <button
            onClick={duplicateSelection}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Copy size={13} />
          </button>
        </Tooltip>

        <span className="mx-1 h-4 w-px bg-line" />

        <Tooltip label={t('editor.trimToPlayheadStart')} side="top">
          <button
            onClick={() => trimToPlayhead('start')}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ArrowLeftToLine size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.trimToPlayheadEnd')} side="top">
          <button
            onClick={() => trimToPlayhead('end')}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ArrowRightToLine size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.closeGaps')} side="top">
          <button
            onClick={closeGaps}
            className="h-7 rounded-sm px-2 text-[11.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            {t('editor.closeGaps')}
          </button>
        </Tooltip>

        <span className="mx-1 h-4 w-px bg-line" />

        <Tooltip label={t('editor.detachAudio')} side="top">
          <button
            onClick={detachAudio}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Volume2 size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.freeze')} side="top">
          <button
            onClick={toggleFreeze}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Snowflake size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.reverse')} side="top">
          <button
            onClick={toggleReverse}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Rewind size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.addMarker')} shortcut="M" side="top">
          <button
            onClick={addMarker}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Flag size={13} />
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
          {formatClockTime(duration)}
        </span>
        <Tooltip label={t('editor.snap')} side="top">
          <button
            onClick={() => setSnapEnabled((v) => !v)}
            aria-pressed={snapEnabled}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-elevated',
              snapEnabled ? 'text-accent' : 'text-ink-faint hover:text-ink',
            )}
          >
            <Magnet size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.pan')} side="top">
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-sm',
              panning ? 'bg-elevated text-ink' : 'text-ink-faint',
            )}
          >
            <Hand size={13} />
          </span>
        </Tooltip>
        <Tooltip label={t('editor.zoomOut')} shortcut="⌘−" side="top">
          <button
            onClick={() => zoomAt(1 / 1.4)}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ZoomOut size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.zoomIn')} shortcut="⌘+" side="top">
          <button
            onClick={() => zoomAt(1.4)}
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ZoomIn size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('editor.fit')} side="top">
          <button
            onClick={zoomToFit}
            className="h-7 rounded-sm px-2 text-[11.5px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            {t('editor.fit')}
          </button>
        </Tooltip>
      </div>

      {duration > 0 && (
        <TimelineMinimap
          state={state}
          duration={duration}
          viewportStart={viewport.scrollLeft / pixelsPerSecond}
          viewportEnd={(viewport.scrollLeft + viewport.width) / pixelsPerSecond}
          playhead={playheadTime}
          onScrubViewport={centreOn}
        />
      )}

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
                      {formatClockTime(time, duration)}
                    </text>
                  </g>
                );
              })}
              {markers.map((marker) => {
                const x = marker.time * pixelsPerSecond;
                return (
                  <g
                    key={marker.id}
                    className="cursor-pointer"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setPlayhead(marker.time);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      dispatch([{ type: 'remove_marker', params: { markerId: marker.id } }], {
                        label: 'Remove marker',
                      });
                    }}
                  >
                    <title>{marker.label || formatClockTime(marker.time, duration)}</title>
                    <path
                      d={`M ${x} 0 L ${x + 9} 0 L ${x + 9} 7 L ${x} 7 Z`}
                      fill={marker.color}
                      opacity={0.9}
                    />
                    <line x1={x} y1={0} x2={x} y2={RULER_HEIGHT} stroke={marker.color} strokeWidth={1} />
                    {marker.label && (
                      <text
                        x={x + 12}
                        y={7}
                        fill="var(--color-ink-muted)"
                        fontSize={9}
                        fontFamily="var(--font-sans)"
                      >
                        {marker.label.slice(0, 24)}
                      </text>
                    )}
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
              className="group/track flex items-center gap-0.5 border-b border-line/60 px-2"
              style={{ height: track.height, marginBottom: TRACK_GAP }}
            >
              <span className="h-6 w-[3px] shrink-0 rounded-xs" style={{ background: TRACK_KIND_COLORS[track.kind] }} />
              <input
                key={`${track.id}-${track.name}`}
                defaultValue={track.name}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== track.name) {
                    dispatch([{ type: 'rename_track', params: { trackId: track.id, name: value } }], {
                      label: 'Rename track',
                    });
                  } else {
                    event.target.value = track.name;
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.currentTarget.value = track.name;
                    event.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 truncate rounded-xs border border-transparent bg-transparent px-1 text-[11.5px] text-ink-muted transition-colors hover:border-line focus:border-accent focus:text-ink focus:outline-none"
              />
              <span className="hidden shrink-0 group-hover/track:flex focus-within:flex">
                <button
                  onClick={() => moveTrack(track, -1)}
                  className="rounded-xs p-0.5 text-ink-faint transition-colors hover:text-ink"
                  title={t('editor.moveTrackUp')}
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  onClick={() => moveTrack(track, 1)}
                  className="rounded-xs p-0.5 text-ink-faint transition-colors hover:text-ink"
                  title={t('editor.moveTrackDown')}
                >
                  <ChevronDown size={11} />
                </button>
                <button
                  onClick={() => removeTrack(track)}
                  className="rounded-xs p-0.5 text-ink-faint transition-colors hover:text-danger"
                  title={t('editor.deleteTrack')}
                >
                  <Trash2 size={11} />
                </button>
              </span>
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
          onScroll={syncViewport}
          onWheel={onWheel}
          onPointerDown={onPanPointerDown}
          className={cn('min-w-0 flex-1 overflow-x-auto', panning ? 'cursor-grabbing' : '')}
        >
          <div
            ref={lanesRef}
            className="relative"
            style={{ width: contentWidth }}
            onPointerDown={(e) => e.target === e.currentTarget && select([])}
            onDragOver={onDragOverLanes}
            onDragLeave={() => setDropHint(null)}
            onDrop={onDropMedia}
          >
            {tracks.map((track) => {
              // Only what is on screen is rendered. A long recording is easily a
              // thousand clips; drawing them all makes every zoom step a
              // thousand-node re-render, and the ones outside the window cannot
              // be seen anyway.
              const trackClips = clipsOnTrack(state, track.id).filter(
                (clip) =>
                  clip.id === drag?.clipId ||
                  (clipEnd(clip) >= visibleRange.start && clip.start <= visibleRange.end),
              );
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

            {dropHint && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-accent"
                style={{ left: dropHint.time * pixelsPerSecond }}
              >
                <span className="absolute -top-1 -left-[3px] h-2 w-2 rounded-full bg-accent" />
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
