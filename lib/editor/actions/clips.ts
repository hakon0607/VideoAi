import { z } from 'zod';
import type { Clip, MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import {
  defineAction,
  requireAsset,
  requireClip,
  requireTrack,
  requireUnlockedClip,
  updateClip,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { baseClipFields, clipFitsTrack } from '../defaults';
import { EditorError } from '../errors';
import { clipEnd, q } from '../time';
import { clipsOnTrack, findFreeSlot } from '../selectors';
import { MIN_CLIP_DURATION, shiftClip, splitClipAt, subtractRange, trimClipEnd, trimClipStart } from '../clip-ops';

const createClip = defineAction({
  type: 'create_clip',
  category: 'clip',
  summary:
    'Place a media asset on a track as a new clip. Omit `start` to append after the last clip on the track, and omit `duration` to use the full asset length.',
  schema: z.object({
    clipId: uuidLike.optional(),
    trackId: uuidLike,
    assetId: uuidLike,
    start: z.number().min(0).optional(),
    duration: z.number().min(MIN_CLIP_DURATION).optional(),
    sourceIn: z.number().min(0).default(0),
    name: z.string().min(1).max(160).optional(),
  }),
  prepare: (params, ctx) => ({ ...params, clipId: params.clipId ?? ctx.newId() }),
  apply: (state, params) => {
    const clipId = params.clipId as string;
    const track = requireTrack(state, params.trackId);
    const asset = requireAsset(state, params.assetId);
    if (track.locked) throw new EditorError('track_locked', `Track "${track.name}" is locked.`, { trackId: track.id });
    const kind = asset.kind;
    if (!clipFitsTrack(kind, track.kind)) {
      throw new EditorError(
        'incompatible_track',
        `A ${kind} clip cannot go on a ${track.kind} track. Create a matching track first.`,
        { trackId: track.id, trackKind: track.kind, assetKind: kind },
      );
    }
    const assetDuration = asset.kind === 'image' ? 5 : asset.duration;
    const available = Math.max(MIN_CLIP_DURATION, assetDuration - params.sourceIn);
    const duration = q(Math.min(params.duration ?? available, asset.kind === 'image' ? params.duration ?? 5 : available));
    const start = q(params.start ?? findFreeSlot(state, track.id, duration));
    const clip: MediaClip = {
      ...baseClipFields(clipId, track.id, start, duration, params.name ?? asset.name),
      kind,
      assetId: asset.id,
      sourceIn: q(params.sourceIn),
      speed: 1,
      reversed: false,
      volume: 1,
      muted: kind === 'image',
      fadeIn: 0,
      fadeOut: 0,
      crop: null,
      freeze: false,
    };
    return {
      state: withClips(state, [...state.clips, clip]),
      description: `Added "${clip.name}" to ${track.name} at ${start.toFixed(2)} s`,
    };
  },
});

const splitClip = defineAction({
  type: 'split_clip',
  category: 'clip',
  summary: 'Cut a clip in two at a timeline timestamp. Both halves stay in place.',
  schema: z.object({
    clipId: uuidLike,
    time: z.number().min(0).describe('Timeline time in seconds, not time inside the clip.'),
    newClipId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({ ...params, newClipId: params.newClipId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const [left, right] = splitClipAt(clip, params.time, params.newClipId as string);
    const clips = state.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c]));
    return { state: withClips(state, clips), description: `Split "${clip.name}" at ${params.time.toFixed(2)} s` };
  },
});

const trimClip = defineAction({
  type: 'trim_clip',
  category: 'clip',
  summary:
    'Move the in and/or out point of a clip on the timeline. The picture stays anchored, so this shortens the clip rather than moving it.',
  schema: z.object({
    clipId: uuidLike,
    start: z.number().min(0).optional().describe('New timeline start.'),
    end: z.number().min(0).optional().describe('New timeline end.'),
  }),
  apply: (state, params) => {
    if (params.start === undefined && params.end === undefined) {
      throw new EditorError('invalid_parameters', 'Provide at least one of `start` or `end`.');
    }
    const clip = requireUnlockedClip(state, params.clipId);
    let next = clip;
    if (params.end !== undefined) next = trimClipEnd(next, params.end);
    if (params.start !== undefined) next = trimClipStart(next, params.start);
    return {
      state: updateClip(state, clip.id, () => next),
      description: `Trimmed "${clip.name}" to ${next.start.toFixed(2)}–${clipEnd(next).toFixed(2)} s`,
    };
  },
});

const moveClip = defineAction({
  type: 'move_clip',
  category: 'clip',
  summary: 'Move a clip to a different position on the timeline, and optionally to another track.',
  schema: z.object({
    clipId: uuidLike,
    start: z.number().min(0).optional(),
    trackId: uuidLike.optional(),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    let next: Clip = { ...clip };
    if (params.start !== undefined) next = { ...next, start: q(params.start) };
    if (params.trackId && params.trackId !== clip.trackId) {
      const track = requireTrack(state, params.trackId);
      if (!clipFitsTrack(clip.kind, track.kind)) {
        throw new EditorError('incompatible_track', `A ${clip.kind} clip cannot go on a ${track.kind} track.`, {
          trackId: track.id,
        });
      }
      next = { ...next, trackId: track.id };
    }
    return {
      state: updateClip(state, clip.id, () => next),
      description: `Moved "${clip.name}" to ${next.start.toFixed(2)} s`,
    };
  },
});

const deleteClip = defineAction({
  type: 'delete_clip',
  category: 'clip',
  summary: 'Remove a clip from the timeline, leaving a gap.',
  schema: z.object({ clipId: uuidLike }),
  apply: (state, { clipId }) => {
    const clip = requireUnlockedClip(state, clipId);
    return {
      state: withClips(state, state.clips.filter((c) => c.id !== clipId)),
      description: `Deleted "${clip.name}"`,
    };
  },
});

const deleteClips = defineAction({
  type: 'delete_clips',
  category: 'clip',
  summary: 'Remove several clips at once.',
  schema: z.object({ clipIds: z.array(uuidLike).min(1).max(2000) }),
  apply: (state, { clipIds }) => {
    const ids = new Set(clipIds);
    for (const id of ids) requireClip(state, id);
    return {
      state: withClips(state, state.clips.filter((c) => !ids.has(c.id))),
      description: `Deleted ${ids.size} clip${ids.size === 1 ? '' : 's'}`,
    };
  },
});

const rippleDeleteClip = defineAction({
  type: 'ripple_delete_clip',
  category: 'clip',
  summary: 'Remove a clip and pull everything after it on the same track backwards to close the gap.',
  schema: z.object({ clipId: uuidLike }),
  apply: (state, { clipId }) => {
    const clip = requireUnlockedClip(state, clipId);
    const gap = clip.duration;
    const clips = state.clips
      .filter((c) => c.id !== clipId)
      .map((c) => (c.trackId === clip.trackId && c.start >= clip.start ? shiftClip(c, -gap) : c));
    return { state: withClips(state, clips), description: `Ripple-deleted "${clip.name}"` };
  },
});

const duplicateClip = defineAction({
  type: 'duplicate_clip',
  category: 'clip',
  summary: 'Copy a clip, including its effects and keyframes. Defaults to placing the copy right after the original.',
  schema: z.object({
    clipId: uuidLike,
    newClipId: uuidLike.optional(),
    start: z.number().min(0).optional(),
    trackId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({ ...params, newClipId: params.newClipId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = requireClip(state, params.clipId);
    const trackId = params.trackId ?? clip.trackId;
    requireTrack(state, trackId);
    const copy: Clip = {
      ...structuredClone(clip),
      id: params.newClipId as string,
      trackId,
      start: q(params.start ?? clipEnd(clip)),
      name: `${clip.name} copy`,
    };
    return { state: withClips(state, [...state.clips, copy]), description: `Duplicated "${clip.name}"` };
  },
});

const removeRange = defineAction({
  type: 'remove_range',
  category: 'clip',
  summary:
    'Cut a time range out of the timeline. This is the action to use for removing pauses, filler words or unwanted sections. With `ripple: true` everything after the range slides backwards so no gap is left.',
  schema: z.object({
    start: z.number().min(0),
    end: z.number().min(0),
    ripple: z.boolean().default(true),
    trackIds: z
      .array(uuidLike)
      .optional()
      .describe('Limit the cut to these tracks. Omit to cut across every track, which is normally what you want.'),
  }),
  apply: (state, params, ctx) => {
    const start = q(params.start);
    const end = q(params.end);
    if (end <= start) {
      throw new EditorError('invalid_range', '`end` must be greater than `start`.', { start, end });
    }
    const targetTracks = params.trackIds ? new Set(params.trackIds) : null;
    if (targetTracks) for (const id of targetTracks) requireTrack(state, id);
    const span = end - start;
    const clips: Clip[] = [];
    for (const clip of state.clips) {
      const inScope = !targetTracks || targetTracks.has(clip.trackId);
      if (!inScope || clip.locked) {
        clips.push(clip);
        continue;
      }
      const pieces = subtractRange(clip, start, end, () => ctx.newId());
      for (const piece of pieces) clips.push(piece);
    }
    const rippled = params.ripple
      ? clips.map((c) => {
          const inScope = !targetTracks || targetTracks.has(c.trackId);
          if (!inScope || c.locked) return c;
          return c.start >= end - 0.0001 ? shiftClip(c, -span) : c;
        })
      : clips;
    return {
      state: withClips(state, rippled),
      description: `Removed ${span.toFixed(2)} s at ${start.toFixed(2)} s${params.ripple ? ' and closed the gap' : ''}`,
    };
  },
});

const removeRanges = defineAction({
  type: 'remove_ranges',
  category: 'clip',
  summary:
    'Cut several time ranges out of the timeline in one go. Ranges are given in the ORIGINAL timeline coordinates; the engine applies them back-to-front so earlier cuts do not shift later ones. Use this to remove all pauses in a single step.',
  schema: z.object({
    ranges: z
      .array(z.object({ start: z.number().min(0), end: z.number().min(0) }))
      .min(1)
      .max(500),
    ripple: z.boolean().default(true),
    trackIds: z.array(uuidLike).optional(),
  }),
  apply: (state, params, ctx) => {
    const sorted = [...params.ranges].map((r) => ({ start: q(r.start), end: q(r.end) })).sort((a, b) => b.start - a.start);
    for (const range of sorted) {
      if (range.end <= range.start) {
        throw new EditorError('invalid_range', 'Every range needs `end` greater than `start`.', range);
      }
    }
    const targetTracks = params.trackIds ? new Set(params.trackIds) : null;
    if (targetTracks) for (const id of targetTracks) requireTrack(state, id);
    let clips = state.clips;
    let removed = 0;
    for (const range of sorted) {
      const span = range.end - range.start;
      const next: Clip[] = [];
      for (const clip of clips) {
        const inScope = !targetTracks || targetTracks.has(clip.trackId);
        if (!inScope || clip.locked) {
          next.push(clip);
          continue;
        }
        for (const piece of subtractRange(clip, range.start, range.end, () => ctx.newId())) next.push(piece);
      }
      clips = params.ripple
        ? next.map((c) => {
            const inScope = !targetTracks || targetTracks.has(c.trackId);
            if (!inScope || c.locked) return c;
            return c.start >= range.end - 0.0001 ? shiftClip(c, -span) : c;
          })
        : next;
      removed += span;
    }
    return {
      state: withClips(state, clips),
      description: `Removed ${sorted.length} section${sorted.length === 1 ? '' : 's'} totalling ${removed.toFixed(1)} s`,
    };
  },
});

const closeGaps = defineAction({
  type: 'close_gaps',
  category: 'clip',
  summary: 'Pull clips on a track together so there are no gaps between them.',
  schema: z.object({ trackId: uuidLike, minGap: z.number().min(0).default(0.02) }),
  apply: (state, params) => {
    requireTrack(state, params.trackId);
    const ordered = clipsOnTrack(state, params.trackId);
    let cursor = 0;
    let moved = 0;
    const moves = new Map<string, number>();
    for (const clip of ordered) {
      if (clip.start - cursor > params.minGap) {
        moves.set(clip.id, cursor);
        moved += 1;
      } else {
        cursor = Math.max(cursor, clip.start);
      }
      cursor = q((moves.get(clip.id) ?? clip.start) + clip.duration);
    }
    if (moved === 0) throw new EditorError('nothing_to_do', 'That track has no gaps to close.');
    const clips = state.clips.map((c) => (moves.has(c.id) ? { ...c, start: moves.get(c.id) as number } : c));
    return { state: withClips(state, clips), description: `Closed ${moved} gap${moved === 1 ? '' : 's'}` };
  },
});

const reorderClips = defineAction({
  type: 'reorder_clips',
  category: 'clip',
  summary: 'Lay the given clips out back-to-back on a track in exactly this order, starting at `start`.',
  schema: z.object({
    trackId: uuidLike,
    clipIds: z.array(uuidLike).min(1).max(500),
    start: z.number().min(0).default(0),
  }),
  apply: (state, params) => {
    requireTrack(state, params.trackId);
    const byId = new Map(state.clips.map((c) => [c.id, c]));
    let cursor = q(params.start);
    const positions = new Map<string, number>();
    for (const id of params.clipIds) {
      const clip = byId.get(id);
      if (!clip) throw new EditorError('clip_not_found', `No clip with id ${id}.`, { clipId: id });
      positions.set(id, cursor);
      cursor = q(cursor + clip.duration);
    }
    const clips = state.clips.map((c) =>
      positions.has(c.id) ? { ...c, trackId: params.trackId, start: positions.get(c.id) as number } : c,
    );
    return { state: withClips(state, clips), description: `Reordered ${params.clipIds.length} clips` };
  },
});

const setClipSpeed = defineAction({
  type: 'set_clip_speed',
  category: 'clip',
  summary:
    'Change playback speed of a media clip. 2 is twice as fast, 0.5 is half speed. The clip length on the timeline changes accordingly.',
  schema: z.object({
    clipId: uuidLike,
    speed: z.number().min(0.1).max(20),
    /** When true, following clips on the track slide to keep them adjacent. */
    ripple: z.boolean().default(true),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(clip)) {
      throw new EditorError('invalid_parameters', 'Speed only applies to video and audio clips.', { clipId: clip.id });
    }
    const oldDuration = clip.duration;
    const duration = q((clip.duration * clip.speed) / params.speed);
    const next: MediaClip = { ...clip, speed: params.speed, duration };
    const delta = duration - oldDuration;
    const clips = state.clips.map((c) => {
      if (c.id === clip.id) return next;
      if (params.ripple && c.trackId === clip.trackId && c.start >= clipEnd(clip) - 0.0001) return shiftClip(c, delta);
      return c;
    });
    return { state: withClips(state, clips), description: `Set "${clip.name}" to ${params.speed}x speed` };
  },
});

const setClipReverse = defineAction({
  type: 'set_clip_reverse',
  category: 'clip',
  summary: 'Play a media clip backwards, or restore forward playback.',
  schema: z.object({ clipId: uuidLike, reversed: z.boolean() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(clip)) throw new EditorError('invalid_parameters', 'Only media clips can be reversed.');
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as MediaClip), reversed: params.reversed })),
      description: params.reversed ? `Reversed "${clip.name}"` : `Restored forward playback on "${clip.name}"`,
    };
  },
});

const setFreezeFrame = defineAction({
  type: 'set_freeze_frame',
  category: 'clip',
  summary: 'Freeze a media clip on the frame at its in-point, so it holds a still image for its whole duration.',
  schema: z.object({ clipId: uuidLike, freeze: z.boolean(), sourceTime: z.number().min(0).optional() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(clip)) throw new EditorError('invalid_parameters', 'Only media clips can be frozen.');
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...(c as MediaClip),
        freeze: params.freeze,
        sourceIn: params.sourceTime !== undefined ? q(params.sourceTime) : (c as MediaClip).sourceIn,
      })),
      description: params.freeze ? `Froze "${clip.name}"` : `Unfroze "${clip.name}"`,
    };
  },
});

const setClipOpacity = defineAction({
  type: 'set_clip_opacity',
  category: 'clip',
  summary: 'Set how opaque a visual clip is, 0 = invisible, 1 = fully opaque.',
  schema: z.object({ clipId: uuidLike, opacity: z.number().min(0).max(1) }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, opacity: params.opacity })),
      description: `Set "${clip.name}" opacity to ${Math.round(params.opacity * 100)}%`,
    };
  },
});

const setTransform = defineAction({
  type: 'set_transform',
  category: 'clip',
  summary:
    'Position, scale, rotate or flip a visual clip. `x`/`y` are offsets from the centre as a fraction of the frame (0.1 = 10% right/down). `scale` 1.2 zooms in 20%.',
  schema: z.object({
    clipId: uuidLike,
    x: z.number().min(-4).max(4).optional(),
    y: z.number().min(-4).max(4).optional(),
    scale: z.number().min(0.05).max(20).optional(),
    rotation: z.number().min(-3600).max(3600).optional(),
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const t = clip.transform;
    const transform = {
      x: params.x ?? t.x,
      y: params.y ?? t.y,
      scale: params.scale ?? t.scale,
      rotation: params.rotation ?? t.rotation,
      flipH: params.flipH ?? t.flipH,
      flipV: params.flipV ?? t.flipV,
    };
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, transform })),
      description: `Transformed "${clip.name}"`,
    };
  },
});

const setCrop = defineAction({
  type: 'set_crop',
  category: 'clip',
  summary: 'Crop a visual clip. Values are fractions of the source frame cut away from each side.',
  schema: z.object({
    clipId: uuidLike,
    left: z.number().min(0).max(0.95).default(0),
    top: z.number().min(0).max(0.95).default(0),
    right: z.number().min(0).max(0.95).default(0),
    bottom: z.number().min(0).max(0.95).default(0),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(clip)) throw new EditorError('invalid_parameters', 'Only media clips can be cropped.');
    if (params.left + params.right >= 1 || params.top + params.bottom >= 1) {
      throw new EditorError('invalid_parameters', 'The crop would remove the entire frame.');
    }
    const crop = { left: params.left, top: params.top, right: params.right, bottom: params.bottom };
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as MediaClip), crop })),
      description: `Cropped "${clip.name}"`,
    };
  },
});

const clearCrop = defineAction({
  type: 'clear_crop',
  category: 'clip',
  summary: 'Remove the crop from a clip.',
  schema: z.object({ clipId: uuidLike }),
  apply: (state, { clipId }) => {
    const clip = requireUnlockedClip(state, clipId);
    return {
      state: updateClip(state, clipId, (c) => ({ ...(c as MediaClip), crop: null })),
      description: `Cleared crop on "${clip.name}"`,
    };
  },
});

const setClipProperties = defineAction({
  type: 'set_clip_properties',
  category: 'clip',
  summary: 'Rename or lock a clip.',
  schema: z.object({
    clipId: uuidLike,
    name: z.string().min(1).max(160).optional(),
    locked: z.boolean().optional(),
  }),
  apply: (state, params) => {
    const clip = requireClip(state, params.clipId);
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        name: params.name ?? c.name,
        locked: params.locked ?? c.locked,
      })),
      description: params.name ? `Renamed clip to "${params.name}"` : `Updated "${clip.name}"`,
    };
  },
});

export const clipActions: AnyActionDef[] = [
  createClip,
  splitClip,
  trimClip,
  moveClip,
  deleteClip,
  deleteClips,
  rippleDeleteClip,
  duplicateClip,
  removeRange,
  removeRanges,
  closeGaps,
  reorderClips,
  setClipSpeed,
  setClipReverse,
  setFreezeFrame,
  setClipOpacity,
  setTransform,
  setCrop,
  clearCrop,
  setClipProperties,
];
