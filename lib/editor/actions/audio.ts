import { z } from 'zod';
import type { MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { defineAction, requireUnlockedClip, updateClip, uuidLike, type AnyActionDef } from '../action-kit';
import { EditorError } from '../errors';

function asAudible(state: Parameters<typeof requireUnlockedClip>[0], clipId: string): MediaClip {
  const clip = requireUnlockedClip(state, clipId);
  if (!isMediaClip(clip) || clip.kind === 'image') {
    throw new EditorError('invalid_parameters', `Clip "${clip.name}" has no audio.`, { clipId });
  }
  return clip;
}

const setClipVolume = defineAction({
  type: 'set_clip_volume',
  category: 'audio',
  summary:
    'Set the volume of one clip. 1 is unchanged, 1.2 is 20% louder, 0 is silent. Use `muted` to silence a clip without losing its level.',
  schema: z.object({
    clipId: uuidLike,
    volume: z.number().min(0).max(4).optional(),
    muted: z.boolean().optional(),
  }),
  apply: (state, params) => {
    const clip = asAudible(state, params.clipId);
    if (params.volume === undefined && params.muted === undefined) {
      throw new EditorError('invalid_parameters', 'Provide `volume` and/or `muted`.');
    }
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...(c as MediaClip),
        volume: params.volume ?? (c as MediaClip).volume,
        muted: params.muted ?? (c as MediaClip).muted,
      })),
      description:
        params.volume !== undefined
          ? `Set "${clip.name}" volume to ${Math.round(params.volume * 100)}%`
          : `${params.muted ? 'Muted' : 'Unmuted'} "${clip.name}"`,
    };
  },
});

const setAudioFade = defineAction({
  type: 'set_audio_fade',
  category: 'audio',
  summary: 'Set fade-in and fade-out lengths in seconds on a clip with audio.',
  schema: z.object({
    clipId: uuidLike,
    fadeIn: z.number().min(0).max(60).optional(),
    fadeOut: z.number().min(0).max(60).optional(),
  }),
  apply: (state, params) => {
    const clip = asAudible(state, params.clipId);
    const fadeIn = Math.min(params.fadeIn ?? clip.fadeIn, clip.duration / 2);
    const fadeOut = Math.min(params.fadeOut ?? clip.fadeOut, clip.duration / 2);
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as MediaClip), fadeIn, fadeOut })),
      description: `Set fades on "${clip.name}" (in ${fadeIn.toFixed(2)}s / out ${fadeOut.toFixed(2)}s)`,
    };
  },
});

const normalizeVolumes = defineAction({
  type: 'normalize_volumes',
  category: 'audio',
  summary:
    'Balance the level of several clips relative to a target. Useful for "make the voice clearer" or "the music is too loud": pass the music clip ids with a lower target.',
  schema: z.object({
    clipIds: z.array(uuidLike).min(1).max(500),
    volume: z.number().min(0).max(4),
  }),
  apply: (state, params) => {
    const ids = new Set(params.clipIds);
    for (const id of ids) asAudible(state, id);
    const clips = state.clips.map((c) => (ids.has(c.id) ? { ...(c as MediaClip), volume: params.volume } : c));
    return {
      state: { ...state, clips },
      description: `Set ${ids.size} clip${ids.size === 1 ? '' : 's'} to ${Math.round(params.volume * 100)}% volume`,
    };
  },
});

const detachAudio = defineAction({
  type: 'detach_audio',
  category: 'audio',
  summary:
    'Split the audio of a video clip onto an audio track as its own clip, so it can be trimmed or levelled independently. The video clip is muted afterwards.',
  schema: z.object({ clipId: uuidLike, trackId: uuidLike, newClipId: uuidLike.optional() }),
  prepare: (params, ctx) => ({ ...params, newClipId: params.newClipId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = asAudible(state, params.clipId);
    if (clip.kind !== 'video') throw new EditorError('invalid_parameters', 'Only video clips carry detachable audio.');
    const track = state.tracks.find((t) => t.id === params.trackId);
    if (!track || track.kind !== 'audio') {
      throw new EditorError('incompatible_track', 'Detached audio needs an audio track.', { trackId: params.trackId });
    }
    const audioClip: MediaClip = {
      ...structuredClone(clip),
      id: params.newClipId as string,
      kind: 'audio',
      trackId: track.id,
      name: `${clip.name} (audio)`,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false },
      effects: [],
      transitionIn: null,
      transitionOut: null,
      muted: false,
    };
    const clips = state.clips.map((c) => (c.id === clip.id ? { ...(c as MediaClip), muted: true } : c));
    return {
      state: { ...state, clips: [...clips, audioClip] },
      description: `Detached audio from "${clip.name}"`,
    };
  },
});

export const audioActions: AnyActionDef[] = [setClipVolume, setAudioFade, normalizeVolumes, detachAudio];
