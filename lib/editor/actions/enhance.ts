import { z } from 'zod';
import type { Clip, MediaClip, MediaFolder, Marker, TextClip } from '@/types/editor';
import { AUDIO_FILTERS, isMediaClip } from '@/types/editor';
import {
  defineAction,
  idsFor,
  requireClip,
  requireTrack,
  requireUnlockedClip,
  updateClip,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { baseClipFields, defaultTextStyle, defaultTrack } from '../defaults';
import { EditorError } from '../errors';
import { clipEnd, q } from '../time';
import { splitClipAt } from '../clip-ops';
import { placeClip } from '../placement';

/* -------------------------------------------------------------------------- */
/* Markers                                                                    */
/* -------------------------------------------------------------------------- */

const addMarker = defineAction({
  type: 'add_marker',
  category: 'project',
  summary:
    'Put a named marker on the timeline. Use it to flag a beat, a punchline or a spot you want to come back to — the user sees it on the ruler and you can read them back with get_markers.',
  schema: z.object({
    time: z.number().min(0),
    label: z.string().max(80).default(''),
    color: z.string().min(3).max(32).default('#6d6aff'),
    markerId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({ ...params, markerId: params.markerId ?? ctx.newId() }),
  apply: (state, params) => {
    const marker: Marker = {
      id: params.markerId as string,
      time: q(params.time),
      label: params.label,
      color: params.color,
    };
    return {
      state: { ...state, markers: [...state.markers, marker].sort((a, b) => a.time - b.time) },
      description: `Marked ${marker.time.toFixed(2)} s${marker.label ? `: ${marker.label}` : ''}`,
    };
  },
});

const removeMarker = defineAction({
  type: 'remove_marker',
  category: 'project',
  summary: 'Delete one marker.',
  schema: z.object({ markerId: uuidLike }),
  apply: (state, { markerId }) => {
    if (!state.markers.some((m) => m.id === markerId)) {
      throw new EditorError('nothing_to_do', `No marker with id ${markerId}.`);
    }
    return {
      state: { ...state, markers: state.markers.filter((m) => m.id !== markerId) },
      description: 'Removed a marker',
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Audio processing                                                           */
/* -------------------------------------------------------------------------- */

const setAudioProcessing = defineAction({
  type: 'set_audio_processing',
  category: 'audio',
  summary:
    'Filter, compress or boost one clip. `voice` rolls off rumble and lifts the presence band — this is the right answer for "make the voice clearer". `telephone`, `radio`, `lowpass` and `warm` are creative looks. Compression 0..1 evens out a recording where levels jump around.',
  schema: z.object({
    clipId: uuidLike,
    filter: z.enum(AUDIO_FILTERS).optional(),
    compression: z.number().min(0).max(1).optional(),
    gainDb: z.number().min(-24).max(24).optional().describe('Extra level in decibels. +6 is roughly twice as loud.'),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(clip) || clip.kind === 'image') {
      throw new EditorError('invalid_parameters', `Clip "${clip.name}" has no audio.`, { clipId: clip.id });
    }
    const audio = {
      ...clip.audio,
      filter: params.filter ?? clip.audio.filter,
      compression: params.compression ?? clip.audio.compression,
      gainDb: params.gainDb ?? clip.audio.gainDb,
    };
    const parts: string[] = [];
    if (params.filter) parts.push(params.filter.replace('_', ' '));
    if (params.compression !== undefined) parts.push(`compression ${Math.round(params.compression * 100)}%`);
    if (params.gainDb !== undefined) parts.push(`${params.gainDb > 0 ? '+' : ''}${params.gainDb} dB`);
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as MediaClip), audio })),
      description: `Processed "${clip.name}": ${parts.join(', ') || 'updated'}`,
    };
  },
});

const enhanceVoice = defineAction({
  type: 'enhance_voice',
  category: 'audio',
  summary:
    'One call for "make the voice clearer": high-pass, presence lift, compression and a small level boost on every clip you name.',
  schema: z.object({
    clipIds: z.array(uuidLike).min(1).max(300),
    strength: z.number().min(0).max(1).default(0.6),
  }),
  apply: (state, params) => {
    const ids = new Set(params.clipIds);
    for (const id of ids) requireClip(state, id);
    const clips = state.clips.map((clip) => {
      if (!ids.has(clip.id) || !isMediaClip(clip) || clip.kind === 'image') return clip;
      return {
        ...clip,
        audio: {
          ...clip.audio,
          filter: 'voice' as const,
          compression: Math.max(clip.audio.compression, params.strength),
          gainDb: Math.min(12, clip.audio.gainDb + params.strength * 3),
        },
      };
    });
    return {
      state: withClips(state, clips),
      description: `Cleaned up the voice on ${ids.size} clip${ids.size === 1 ? '' : 's'}`,
    };
  },
});

const autoDuck = defineAction({
  type: 'auto_duck',
  category: 'audio',
  summary:
    'Make music automatically drop under speech. Point the music clips at the tracks that carry the talking; the level ramps down while someone speaks and back up after.',
  schema: z.object({
    musicClipIds: z.array(uuidLike).min(1).max(100),
    speechTrackIds: z.array(uuidLike).min(1).max(32),
    amount: z.number().min(0).max(1).default(0.7).describe('0.7 means duck to 30% under speech.'),
  }),
  apply: (state, params) => {
    const ids = new Set(params.musicClipIds);
    for (const id of ids) requireClip(state, id);
    for (const id of params.speechTrackIds) requireTrack(state, id);

    const clips = state.clips.map((clip) => {
      if (!ids.has(clip.id) || !isMediaClip(clip) || clip.kind === 'image') return clip;
      return {
        ...clip,
        audio: { ...clip.audio, duckUnderTrackIds: params.speechTrackIds, duckAmount: params.amount },
      };
    });
    return {
      state: withClips(state, clips),
      description: `Ducked ${ids.size} clip${ids.size === 1 ? '' : 's'} to ${Math.round((1 - params.amount) * 100)}% under speech`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Pace                                                                       */
/* -------------------------------------------------------------------------- */

const addSpeedRamp = defineAction({
  type: 'add_speed_ramp',
  category: 'clip',
  summary:
    'Split a clip into sections at the given times and give each one its own speed. This is how you do "slow down the funny bit and speed through the rest" in one call.',
  schema: z.object({
    clipId: uuidLike,
    sections: z
      .array(
        z.object({
          /** Timeline seconds where this section begins. The first may be omitted. */
          from: z.number().min(0),
          speed: z.number().min(0.1).max(20),
        }),
      )
      .min(1)
      .max(20),
    newClipIds: z.array(uuidLike).optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    newClipIds: idsFor(params.newClipIds, params.sections.length, ctx),
  }),
  apply: (state, params, ctx) => {
    const original = requireUnlockedClip(state, params.clipId);
    if (!isMediaClip(original)) {
      throw new EditorError('invalid_parameters', 'Speed ramps only apply to media clips.');
    }

    const cuts = [...params.sections]
      .map((section) => ({ ...section, from: q(section.from) }))
      .sort((a, b) => a.from - b.from)
      .filter((section) => section.from > original.start + 0.05 && section.from < clipEnd(original) - 0.05);

    let working = state;
    let current = original.id;
    const pieces: { id: string; speed: number }[] = [
      { id: original.id, speed: params.sections[0].speed },
    ];
    const newIds = params.newClipIds as string[];

    // Split front to back; each split leaves the tail as the next piece.
    cuts.forEach((cut, index) => {
      const clip = working.clips.find((c) => c.id === current) as MediaClip | undefined;
      if (!clip) return;
      const [left, right] = splitClipAt(clip, cut.from, newIds[index] ?? ctx.newId());
      working = withClips(
        working,
        working.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])),
      );
      current = right.id;
      pieces.push({ id: right.id, speed: cut.speed });
    });

    // Then apply the speeds back to front, so earlier pieces do not shift the
    // ones we have not touched yet.
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i];
      const clip = working.clips.find((c) => c.id === piece.id) as MediaClip | undefined;
      if (!clip) continue;
      const duration = q((clip.duration * clip.speed) / piece.speed);
      const delta = duration - clip.duration;
      working = withClips(
        working,
        working.clips.map((c) => {
          if (c.id === clip.id) return { ...(c as MediaClip), speed: piece.speed, duration };
          if (c.trackId === clip.trackId && c.start >= clipEnd(clip) - 0.0001) {
            return { ...c, start: q(c.start + delta) };
          }
          return c;
        }),
      );
    }

    return {
      state: working,
      description: `Speed-ramped "${original.name}" into ${pieces.length} section${pieces.length === 1 ? '' : 's'}`,
    };
  },
});

const addZoomPunch = defineAction({
  type: 'add_zoom_punch',
  category: 'keyframe',
  summary:
    'A quick punch-in on a moment: scales up fast and settles back. The single most useful move for making a talking-head clip feel edited.',
  schema: z.object({
    clipId: uuidLike,
    /** Timeline seconds where the punch lands. */
    at: z.number().min(0),
    scale: z.number().min(1.01).max(3).default(1.25),
    attack: z.number().min(0.05).max(2).default(0.18),
    hold: z.number().min(0).max(10).default(1.2),
    keyframeIds: z.array(uuidLike).optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    keyframeIds: idsFor(params.keyframeIds, 4, ctx),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (clip.kind === 'audio') throw new EditorError('invalid_parameters', 'A zoom needs a visual clip.');

    const local = q(params.at - clip.start);
    if (local < -0.01 || local > clip.duration + 0.01) {
      throw new EditorError('invalid_time', `${params.at}s is not inside "${clip.name}".`, {
        clipStart: clip.start,
        clipEnd: clipEnd(clip),
      });
    }

    const ids = params.keyframeIds as string[];
    const base = clip.transform.scale;
    const start = Math.max(0, local - 0.02);
    const peak = Math.min(clip.duration, start + params.attack);
    const holdEnd = Math.min(clip.duration, peak + params.hold);
    const settle = Math.min(clip.duration, holdEnd + params.attack * 1.6);

    const keyframes = [
      ...clip.keyframes.filter((kf) => kf.property !== 'scale' || kf.time < start - 0.001 || kf.time > settle + 0.001),
      { id: ids[0], property: 'scale' as const, time: q(start), value: base, easing: 'ease_out' as const },
      { id: ids[1], property: 'scale' as const, time: q(peak), value: base * params.scale, easing: 'ease_out' as const },
      { id: ids[2], property: 'scale' as const, time: q(holdEnd), value: base * params.scale, easing: 'ease_in_out' as const },
      { id: ids[3], property: 'scale' as const, time: q(settle), value: base, easing: 'ease_in_out' as const },
    ].sort((a, b) => a.time - b.time);

    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, keyframes })),
      description: `Punched in ${Math.round((params.scale - 1) * 100)}% at ${params.at.toFixed(2)} s`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Stickers                                                                   */
/* -------------------------------------------------------------------------- */

const addSticker = defineAction({
  type: 'add_sticker',
  category: 'text',
  summary:
    'Drop an emoji sticker on the frame. Position with x/y as a fraction of the frame from centre, and size as a fraction of frame height.',
  schema: z.object({
    emoji: z.string().min(1).max(8),
    start: z.number().min(0),
    duration: z.number().min(0.1).max(600).default(2),
    x: z.number().min(-1.5).max(1.5).default(0),
    y: z.number().min(-1.5).max(1.5).default(-0.25),
    size: z.number().min(0.02).max(0.8).default(0.16),
    rotation: z.number().min(-180).max(180).default(0),
    animation: z.enum(['none', 'pop', 'bounce', 'shake', 'zoom_in', 'fade']).default('pop'),
    trackId: uuidLike.optional(),
    clipId: uuidLike.optional(),
    newTrackId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    clipId: params.clipId ?? ctx.newId(),
    newTrackId: params.newTrackId ?? ctx.newId(),
  }),
  apply: (state, params) => {
    let tracks = state.tracks;
    let track = params.trackId
      ? requireTrack(state, params.trackId)
      : tracks.find((t) => (t.kind === 'overlay' || t.kind === 'text') && !t.locked);

    if (!track) {
      const index = Math.max(...tracks.map((t) => t.index), -1) + 1;
      // defaultTrack rather than a spread of tracks[0]: a project with no
      // tracks at all would otherwise produce a track with no volume or flags.
      const created = defaultTrack(params.newTrackId as string, 'overlay', index, 'Stickers');
      created.height = 48;
      tracks = [...tracks, created];
      track = created;
    }

    const start = q(params.start);
    const duration = q(params.duration);
    const placement = placeClip({ ...state, tracks }, track, 'text', start, start + duration, params.newTrackId as string);
    const nextTracks = placement.createdTrack ? [...tracks, placement.createdTrack] : tracks;

    const base = baseClipFields(params.clipId as string, placement.trackId, start, duration, params.emoji);
    const clip: TextClip = {
      ...base,
      kind: 'text',
      text: params.emoji,
      animation: params.animation,
      style: {
        ...defaultTextStyle(),
        fontSize: params.size,
        strokeWidth: 0,
        shadowBlur: 0.006,
        backgroundColor: 'rgba(0,0,0,0)',
        maxWidth: 1,
      },
      transform: { ...base.transform, x: params.x, y: params.y, rotation: params.rotation },
    };

    return {
      state: withClips({ ...state, tracks: nextTracks }, [...state.clips, clip]),
      description: `Added ${params.emoji} at ${start.toFixed(2)} s`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Media library folders                                                      */
/* -------------------------------------------------------------------------- */

const createFolder = defineAction({
  type: 'create_media_folder',
  category: 'media',
  summary: 'Create a folder in the media library, so a big shoot stays navigable.',
  schema: z.object({
    name: z.string().min(1).max(80),
    parentId: uuidLike.nullable().default(null),
    folderId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({ ...params, folderId: params.folderId ?? ctx.newId() }),
  apply: (state, params) => {
    if (params.parentId && !state.folders.some((f) => f.id === params.parentId)) {
      throw new EditorError('invalid_parameters', `No folder with id ${params.parentId}.`);
    }
    const folder: MediaFolder = {
      id: params.folderId as string,
      name: params.name,
      parentId: params.parentId ?? null,
      createdAt: new Date().toISOString(),
    };
    return {
      state: { ...state, folders: [...state.folders, folder] },
      description: `Created the folder "${params.name}"`,
    };
  },
});

const moveToFolder = defineAction({
  type: 'move_media_to_folder',
  category: 'media',
  summary: 'File media into a folder. Pass folderId null to move it back to the top level.',
  schema: z.object({
    assetIds: z.array(uuidLike).min(1).max(500),
    folderId: uuidLike.nullable(),
  }),
  apply: (state, params) => {
    if (params.folderId && !state.folders.some((f) => f.id === params.folderId)) {
      throw new EditorError('invalid_parameters', `No folder with id ${params.folderId}.`);
    }
    const ids = new Set(params.assetIds);
    let moved = 0;
    const assets = state.assets.map((asset) => {
      if (!ids.has(asset.id)) return asset;
      moved += 1;
      return { ...asset, folderId: params.folderId };
    });
    if (moved === 0) throw new EditorError('asset_not_found', 'None of those assets are in this project.');
    return {
      state: { ...state, assets },
      description: `Moved ${moved} file${moved === 1 ? '' : 's'}`,
    };
  },
});

const renameFolder = defineAction({
  type: 'rename_media_folder',
  category: 'media',
  summary: 'Rename a media folder.',
  schema: z.object({ folderId: uuidLike, name: z.string().min(1).max(80) }),
  apply: (state, params) => {
    if (!state.folders.some((f) => f.id === params.folderId)) {
      throw new EditorError('invalid_parameters', `No folder with id ${params.folderId}.`);
    }
    return {
      state: {
        ...state,
        folders: state.folders.map((f) => (f.id === params.folderId ? { ...f, name: params.name } : f)),
      },
      description: `Renamed a folder to "${params.name}"`,
    };
  },
});

const deleteFolder = defineAction({
  type: 'delete_media_folder',
  category: 'media',
  summary: 'Delete a folder. Its files move back to the top level rather than being deleted.',
  schema: z.object({ folderId: uuidLike }),
  apply: (state, { folderId }) => {
    if (!state.folders.some((f) => f.id === folderId)) {
      throw new EditorError('invalid_parameters', `No folder with id ${folderId}.`);
    }
    return {
      state: {
        ...state,
        folders: state.folders.filter((f) => f.id !== folderId),
        assets: state.assets.map((a) => (a.folderId === folderId ? { ...a, folderId: null } : a)),
      },
      description: 'Deleted a folder',
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Bulk convenience                                                           */
/* -------------------------------------------------------------------------- */

const applyToClips = defineAction({
  type: 'apply_effect_to_clips',
  category: 'effect',
  summary:
    'Add the same effect to many clips at once — a grade across the whole edit, for example. Far cheaper than one call per clip.',
  schema: z.object({
    clipIds: z.array(uuidLike).min(1).max(500),
    type: z.string().min(1),
    params: z.record(z.string(), z.number()).default({}),
    effectIds: z.array(uuidLike).optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    effectIds: idsFor(params.effectIds, params.clipIds.length, ctx),
  }),
  apply: (state, params) => {
    const ids = params.clipIds as string[];
    const effectIds = params.effectIds as string[];
    for (const id of ids) requireClip(state, id);

    const clips: Clip[] = state.clips.map((clip) => {
      const index = ids.indexOf(clip.id);
      if (index < 0 || clip.kind === 'audio') return clip;
      return {
        ...clip,
        effects: [
          ...clip.effects,
          {
            id: effectIds[index],
            type: params.type as Clip['effects'][number]['type'],
            enabled: true,
            params: params.params,
          },
        ],
      };
    });
    return {
      state: withClips(state, clips),
      description: `Added ${params.type} to ${ids.length} clip${ids.length === 1 ? '' : 's'}`,
    };
  },
});

export const enhanceActions: AnyActionDef[] = [
  addMarker,
  removeMarker,
  setAudioProcessing,
  enhanceVoice,
  autoDuck,
  addSpeedRamp,
  addZoomPunch,
  addSticker,
  createFolder,
  moveToFolder,
  renameFolder,
  deleteFolder,
  applyToClips,
];
