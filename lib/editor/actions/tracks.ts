import { z } from 'zod';
import { TRACK_KINDS } from '@/types/editor';
import { defineAction, requireTrack, updateTrack, uuidLike, type AnyActionDef } from '../action-kit';
import { defaultTrack } from '../defaults';
import { EditorError } from '../errors';

const createTrack = defineAction({
  type: 'create_track',
  category: 'track',
  summary:
    'Add a new track. Video/overlay tracks hold video and image clips, audio tracks hold audio, text tracks hold text and captions. Higher index means drawn on top.',
  schema: z.object({
    trackId: uuidLike.optional(),
    kind: z.enum(TRACK_KINDS),
    name: z.string().min(1).max(80).optional(),
    index: z.number().int().min(0).max(64).optional(),
  }),
  prepare: (params, ctx) => ({ ...params, trackId: params.trackId ?? ctx.newId() }),
  apply: (state, params) => {
    const trackId = params.trackId as string;
    if (state.tracks.some((t) => t.id === trackId)) {
      throw new EditorError('duplicate_id', `A track with id ${trackId} already exists.`, { trackId });
    }
    if (state.tracks.length >= 32) {
      throw new EditorError('limit_exceeded', 'A timeline can hold at most 32 tracks.');
    }
    const index = params.index ?? state.tracks.length;
    const shifted = state.tracks.map((t) => (t.index >= index ? { ...t, index: t.index + 1 } : t));
    const track = defaultTrack(trackId, params.kind, index, params.name);
    return {
      state: { ...state, tracks: [...shifted, track] },
      description: `Added ${params.kind} track "${track.name}"`,
    };
  },
});

const deleteTrack = defineAction({
  type: 'delete_track',
  category: 'track',
  summary: 'Delete a track and every clip on it.',
  destructive: true,
  schema: z.object({ trackId: uuidLike }),
  apply: (state, { trackId }) => {
    const track = requireTrack(state, trackId);
    const removed = state.clips.filter((c) => c.trackId === trackId).length;
    const tracks = state.tracks
      .filter((t) => t.id !== trackId)
      .map((t) => (t.index > track.index ? { ...t, index: t.index - 1 } : t));
    return {
      state: { ...state, tracks, clips: state.clips.filter((c) => c.trackId !== trackId) },
      description: `Deleted track "${track.name}" and ${removed} clip${removed === 1 ? '' : 's'}`,
    };
  },
});

const renameTrack = defineAction({
  type: 'rename_track',
  category: 'track',
  summary: 'Rename a track.',
  schema: z.object({ trackId: uuidLike, name: z.string().min(1).max(80) }),
  apply: (state, { trackId, name }) => ({
    state: updateTrack(state, trackId, (t) => ({ ...t, name })),
    description: `Renamed track to "${name}"`,
  }),
});

const moveTrack = defineAction({
  type: 'move_track',
  category: 'track',
  summary: 'Move a track up or down in the stacking order. Index 0 is the bottom-most layer.',
  schema: z.object({ trackId: uuidLike, index: z.number().int().min(0).max(63) }),
  apply: (state, { trackId, index }) => {
    const track = requireTrack(state, trackId);
    const ordered = [...state.tracks].sort((a, b) => a.index - b.index).filter((t) => t.id !== trackId);
    const target = Math.min(index, ordered.length);
    ordered.splice(target, 0, track);
    const tracks = ordered.map((t, i) => ({ ...t, index: i }));
    return { state: { ...state, tracks }, description: `Moved track "${track.name}" to position ${target + 1}` };
  },
});

const setTrackProperties = defineAction({
  type: 'set_track_properties',
  category: 'track',
  summary: 'Mute, hide, lock or set the volume of a whole track.',
  schema: z.object({
    trackId: uuidLike,
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    volume: z.number().min(0).max(4).optional(),
    height: z.number().int().min(32).max(200).optional(),
  }),
  apply: (state, params) => {
    const track = requireTrack(state, params.trackId);
    const next = {
      ...track,
      muted: params.muted ?? track.muted,
      hidden: params.hidden ?? track.hidden,
      locked: params.locked ?? track.locked,
      volume: params.volume ?? track.volume,
      height: params.height ?? track.height,
    };
    const changes: string[] = [];
    if (params.muted !== undefined) changes.push(params.muted ? 'muted' : 'unmuted');
    if (params.hidden !== undefined) changes.push(params.hidden ? 'hidden' : 'shown');
    if (params.locked !== undefined) changes.push(params.locked ? 'locked' : 'unlocked');
    if (params.volume !== undefined) changes.push(`volume ${Math.round(params.volume * 100)}%`);
    return {
      state: updateTrack(state, params.trackId, () => next),
      description: `Track "${track.name}": ${changes.join(', ') || 'updated'}`,
    };
  },
});

export const trackActions: AnyActionDef[] = [
  createTrack,
  deleteTrack,
  renameTrack,
  moveTrack,
  setTrackProperties,
];
