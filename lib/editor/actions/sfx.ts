import { z } from 'zod';
import type { MediaAsset, MediaClip } from '@/types/editor';
import {
  defineAction,
  idsFor,
  requireTrack,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { baseClipFields, defaultAudioProcessing, defaultTrack } from '../defaults';
import { EditorError } from '../errors';
import { q } from '../time';
import { placeClip } from '../placement';

/** Marks an asset as one of the built-in synthesised sounds. */
export const SFX_PATH_PREFIX = 'sfx:';

/**
 * The library the assistant can choose from. Kept here rather than imported
 * from the client module so the action registry stays free of browser APIs.
 */
export const SFX_IDS = [
  'whoosh',
  'whoosh_deep',
  'swish',
  'riser',
  'impact',
  'thud',
  'boom',
  'pop',
  'click',
  'ding',
  'sparkle',
  'boing',
  'record_scratch',
  'error',
  'chime_up',
  'chime_down',
] as const;

export const SFX_DURATIONS: Record<string, number> = {
  whoosh: 0.7,
  whoosh_deep: 1.1,
  swish: 0.35,
  riser: 1.6,
  impact: 1.2,
  thud: 0.5,
  boom: 1.8,
  pop: 0.18,
  click: 0.09,
  ding: 1.4,
  sparkle: 1.0,
  boing: 0.6,
  record_scratch: 0.7,
  error: 0.45,
  chime_up: 1.3,
  chime_down: 1.3,
};

const addSoundEffect = defineAction({
  type: 'add_sound_effect',
  category: 'audio',
  summary:
    'Drop one of the built-in sound effects onto the timeline. Use it for a whoosh under a text reveal, a pop when something appears, an impact on a beat, or a record scratch on a punchline. The sound is synthesised, so it is always available — call get_sound_effects for the catalogue.',
  schema: z.object({
    sound: z.enum(SFX_IDS),
    start: z.number().min(0).describe('Timeline seconds where the sound should hit.'),
    trackId: uuidLike.optional().describe('Omit to place it on a free audio track.'),
    volume: z.number().min(0).max(4).default(0.8),
    fadeOut: z.number().min(0).max(5).default(0.05),
    clipId: uuidLike.optional(),
    assetId: uuidLike.optional(),
    newTrackId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    clipId: params.clipId ?? ctx.newId(),
    assetId: params.assetId ?? ctx.newId(),
    newTrackId: params.newTrackId ?? ctx.newId(),
  }),
  apply: (state, params) => {
    const duration = SFX_DURATIONS[params.sound] ?? 0.6;
    const storagePath = `${SFX_PATH_PREFIX}${params.sound}`;

    // One asset per sound per project: the second whoosh reuses the first.
    const existing = state.assets.find((asset) => asset.storagePath === storagePath);
    const assetId = existing?.id ?? (params.assetId as string);

    let assets = state.assets;
    if (!existing) {
      const asset: MediaAsset = {
        id: assetId,
        projectId: state.projectId,
        folderId: null,
        kind: 'audio',
        name: params.sound.replace(/_/g, ' '),
        storagePath,
        mimeType: 'audio/wav',
        sizeBytes: 0,
        duration,
        width: null,
        height: null,
        fps: null,
        hasAudio: true,
        sampleRate: 44100,
        channels: 1,
        waveform: null,
        thumbnailUrl: null,
        analysisStatus: 'basic',
        createdAt: new Date().toISOString(),
      };
      assets = [...assets, asset];
    }

    // Find an audio track, or make one.
    let tracks = state.tracks;
    let track = params.trackId
      ? requireTrack(state, params.trackId)
      : tracks.find((t) => t.kind === 'audio' && !t.locked);

    if (!track) {
      const index = Math.max(...tracks.map((t) => t.index), -1) + 1;
      const created = defaultTrack(params.newTrackId as string, 'audio', index, 'Sound effects');
      created.height = 44;
      tracks = [...tracks, created];
      track = created;
    }
    if (track.kind !== 'audio') {
      throw new EditorError('incompatible_track', 'Sound effects need an audio track.', { trackId: track.id });
    }

    const start = q(params.start);
    const working = { ...state, assets, tracks };
    const placement = placeClip(working, track, 'audio', start, start + duration, params.newTrackId as string);
    const nextTracks = placement.createdTrack ? [...tracks, placement.createdTrack] : tracks;

    const clip: MediaClip = {
      ...baseClipFields(params.clipId as string, placement.trackId, start, duration, params.sound.replace(/_/g, ' ')),
      kind: 'audio',
      assetId,
      sourceIn: 0,
      speed: 1,
      reversed: false,
      volume: params.volume,
      muted: false,
      fadeIn: 0,
      fadeOut: Math.min(params.fadeOut, duration / 2),
      crop: null,
      freeze: false,
      audio: defaultAudioProcessing(),
    };

    return {
      state: withClips({ ...state, assets, tracks: nextTracks }, [...state.clips, clip]),
      description: `Added a ${params.sound.replace(/_/g, ' ')} at ${start.toFixed(2)} s`,
    };
  },
});

const addSoundEffects = defineAction({
  type: 'add_sound_effects',
  category: 'audio',
  summary:
    'Drop several sound effects at once. Much better than calling add_sound_effect repeatedly when you are scoring a whole edit.',
  schema: z.object({
    sounds: z
      .array(
        z.object({
          sound: z.enum(SFX_IDS),
          start: z.number().min(0),
          volume: z.number().min(0).max(4).default(0.8),
        }),
      )
      .min(1)
      .max(200),
    trackId: uuidLike.optional(),
    clipIds: z.array(uuidLike).optional(),
    assetIds: z.array(uuidLike).optional(),
    newTrackIds: z.array(uuidLike).optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    clipIds: idsFor(params.clipIds, params.sounds.length, ctx),
    assetIds: idsFor(params.assetIds, params.sounds.length, ctx),
    // One spare lane id per sound: several sounds landing on the same beat each
    // need their own track, and reusing one id would collide.
    newTrackIds: idsFor(params.newTrackIds, params.sounds.length, ctx),
  }),
  apply: (state, params, ctx) => {
    // Composed from the single-sound action so there is one implementation of
    // "where does a sound effect go".
    let working = state;
    const clipIds = params.clipIds as string[];
    const assetIds = params.assetIds as string[];
    const trackIds = params.newTrackIds as string[];

    params.sounds.forEach((sound, index) => {
      const result = addSoundEffect.apply(
        working,
        {
          sound: sound.sound,
          start: sound.start,
          volume: sound.volume,
          fadeOut: 0.05,
          trackId: params.trackId,
          clipId: clipIds[index],
          assetId: assetIds[index],
          newTrackId: trackIds[index],
        },
        ctx,
      );
      working = result.state;
    });

    return {
      state: working,
      description: `Added ${params.sounds.length} sound effect${params.sounds.length === 1 ? '' : 's'}`,
    };
  },
});

export const sfxActions: AnyActionDef[] = [addSoundEffect, addSoundEffects];
