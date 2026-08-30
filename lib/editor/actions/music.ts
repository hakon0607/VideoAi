import { z } from 'zod';
import type { MediaAsset, MediaClip } from '@/types/editor';
import {
  defineAction,
  requireTrack,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { baseClipFields, defaultAudioProcessing, defaultTrack } from '../defaults';
import { EditorError } from '../errors';
import { q } from '../time';
import { placeClip } from '../placement';

/** Marks an asset as one of the built-in synthesised music beds. */
export const MUSIC_PATH_PREFIX = 'music:';

/**
 * The beds the assistant can choose from. Kept here rather than imported from
 * the browser module so the action registry stays free of audio APIs.
 */
export const MUSIC_IDS = [
  'upbeat_pop',
  'energy_run',
  'calm_piano',
  'ambient_pad',
  'dramatic_build',
  'dark_pulse',
  'playful_marimba',
  'quirky_pluck',
  'lofi_chill',
  'lofi_night',
] as const;

/** Every bed is one sixteen-second loop. */
export const MUSIC_LOOP_SECONDS = 16;

const addMusic = defineAction({
  type: 'add_music',
  category: 'audio',
  summary:
    'Lay a built-in music bed under the edit, looped to cover a stretch of the timeline. The music is synthesised, so it is always available and free to use commercially — call get_music for the catalogue and pick a mood that matches the footage. Duck it under speech with auto_duck afterwards.',
  schema: z.object({
    bed: z.enum(MUSIC_IDS),
    start: z.number().min(0).default(0).describe('Timeline seconds where the music should start.'),
    duration: z
      .number()
      .min(1)
      .max(7200)
      .optional()
      .describe('How long the music should play. Omit to cover the rest of the timeline.'),
    volume: z.number().min(0).max(4).default(0.35).describe('Music sits under everything else; 0.3–0.4 is normal.'),
    fadeIn: z.number().min(0).max(10).default(0.5),
    fadeOut: z.number().min(0).max(10).default(1.5),
    trackId: uuidLike.optional().describe('Omit to place it on a free audio track.'),
    clipIds: z.array(uuidLike).optional(),
    assetId: uuidLike.optional(),
    newTrackId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => {
    // One clip per loop, so the ids have to be generated before the action runs
    // for the batch to replay identically on another machine.
    const span = params.duration ?? 600;
    const loops = Math.max(1, Math.ceil(span / MUSIC_LOOP_SECONDS));
    return {
      ...params,
      assetId: params.assetId ?? ctx.newId(),
      newTrackId: params.newTrackId ?? ctx.newId(),
      clipIds:
        params.clipIds && params.clipIds.length >= loops
          ? params.clipIds
          : Array.from({ length: loops }, () => ctx.newId()),
    };
  },
  apply: (state, params) => {
    const storagePath = `${MUSIC_PATH_PREFIX}${params.bed}`;

    // One asset per bed per project: a second use of the same music reuses it.
    const existing = state.assets.find((asset) => asset.storagePath === storagePath);
    const assetId = existing?.id ?? (params.assetId as string);

    let assets = state.assets;
    if (!existing) {
      const asset: MediaAsset = {
        id: assetId,
        projectId: state.projectId,
        folderId: null,
        kind: 'audio',
        name: params.bed.replace(/_/g, ' '),
        storagePath,
        mimeType: 'audio/wav',
        sizeBytes: 0,
        duration: MUSIC_LOOP_SECONDS,
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

    let tracks = state.tracks;
    let track = params.trackId
      ? requireTrack(state, params.trackId)
      : tracks.find((t) => t.kind === 'audio' && !t.locked);

    if (!track) {
      const index = Math.max(...tracks.map((t) => t.index), -1) + 1;
      const created = defaultTrack(params.newTrackId as string, 'audio', index, 'Music');
      tracks = [...tracks, created];
      track = created;
    }
    if (track.kind !== 'audio') {
      throw new EditorError('incompatible_track', 'Music needs an audio track.', { trackId: track.id });
    }

    // Cover the rest of the timeline when no length was asked for.
    const timelineEnd = state.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    const start = q(params.start);
    const span = q(Math.max(1, params.duration ?? Math.max(MUSIC_LOOP_SECONDS, timelineEnd - start)));
    const clipIds = params.clipIds as string[];

    let working = { ...state, assets, tracks };
    const clips: MediaClip[] = [];
    let cursor = start;
    let index = 0;
    while (cursor < start + span - 0.05 && index < clipIds.length) {
      const length = q(Math.min(MUSIC_LOOP_SECONDS, start + span - cursor));
      const placement = placeClip(
        working,
        track,
        'audio',
        cursor,
        cursor + length,
        params.newTrackId as string,
      );
      if (placement.createdTrack) {
        working = { ...working, tracks: [...working.tracks, placement.createdTrack] };
      }
      const clip: MediaClip = {
        ...baseClipFields(clipIds[index], placement.trackId, cursor, length, params.bed.replace(/_/g, ' ')),
        kind: 'audio',
        assetId,
        sourceIn: 0,
        speed: 1,
        reversed: false,
        volume: params.volume,
        muted: false,
        // Only the first loop fades in and only the last one fades out.
        fadeIn: index === 0 ? Math.min(params.fadeIn, length / 2) : 0,
        fadeOut: 0,
        crop: null,
        freeze: false,
        audio: defaultAudioProcessing(),
      };
      clips.push(clip);
      working = { ...working, clips: [...working.clips, clip] };
      cursor = q(cursor + length);
      index += 1;
    }

    if (clips.length === 0) {
      throw new EditorError('nothing_to_do', 'That leaves no room for music.', { start, span });
    }

    const last = clips[clips.length - 1];
    last.fadeOut = Math.min(params.fadeOut, last.duration / 2);

    return {
      state: withClips({ ...working, assets }, working.clips),
      description: `Added "${params.bed.replace(/_/g, ' ')}" from ${start.toFixed(1)} s for ${span.toFixed(1)} s`,
    };
  },
});

export const musicActions: AnyActionDef[] = [addMusic];
