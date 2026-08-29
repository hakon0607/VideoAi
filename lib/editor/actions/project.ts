import { z } from 'zod';
import { ASPECT_RATIOS } from '@/types/editor';
import { defineAction, type AnyActionDef } from '../action-kit';
import { ASPECT_RATIO_VALUES, resolutionForAspect } from '../defaults';
import { EditorError } from '../errors';

const setProjectName = defineAction({
  type: 'set_project_name',
  category: 'project',
  summary: 'Rename the project.',
  schema: z.object({ name: z.string().min(1).max(120) }),
  apply: (state, { name }) => ({
    state: { ...state, name },
    description: `Renamed the project to "${name}"`,
  }),
});

const setAspectRatio = defineAction({
  type: 'set_aspect_ratio',
  category: 'project',
  summary:
    'Change the canvas aspect ratio, e.g. to make a 9:16 vertical version for TikTok or Shorts. Resolution follows the new ratio automatically.',
  schema: z.object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    /**
     * How existing clips adapt. `cover` scales them up so they fill the new
     * frame (the usual choice when going 16:9 -> 9:16), `contain` letterboxes
     * them, `none` leaves transforms untouched.
     */
    fit: z.enum(['cover', 'contain', 'none']).default('cover'),
  }),
  apply: (state, { aspectRatio, fit }) => {
    const { width, height } = resolutionForAspect(aspectRatio, state.settings.height);
    const oldRatio = ASPECT_RATIO_VALUES[state.settings.aspectRatio];
    const newRatio = ASPECT_RATIO_VALUES[aspectRatio];
    let clips = state.clips;
    if (fit !== 'none' && oldRatio !== newRatio) {
      // Visual clips are letterboxed by default, so compensate with scale.
      const factor = fit === 'cover' ? Math.max(oldRatio / newRatio, newRatio / oldRatio) : 1;
      clips = state.clips.map((clip) =>
        clip.kind === 'audio' || clip.kind === 'text'
          ? clip
          : { ...clip, transform: { ...clip.transform, scale: clip.transform.scale * factor } },
      );
    }
    return {
      state: { ...state, clips, settings: { ...state.settings, aspectRatio, width, height } },
      description: `Changed aspect ratio to ${aspectRatio} (${width}x${height})`,
    };
  },
});

const setResolution = defineAction({
  type: 'set_resolution',
  category: 'project',
  summary: 'Set an explicit render resolution in pixels.',
  schema: z.object({
    width: z.number().int().min(64).max(7680),
    height: z.number().int().min(64).max(4320),
  }),
  apply: (state, { width, height }) => ({
    state: { ...state, settings: { ...state.settings, width, height } },
    description: `Set resolution to ${width}x${height}`,
  }),
});

const setFps = defineAction({
  type: 'set_fps',
  category: 'project',
  summary: 'Set the project frame rate.',
  schema: z.object({ fps: z.number().min(1).max(120) }),
  apply: (state, { fps }) => ({
    state: { ...state, settings: { ...state.settings, fps } },
    description: `Set frame rate to ${fps} fps`,
  }),
});

const setBackgroundColor = defineAction({
  type: 'set_background_color',
  category: 'project',
  summary: 'Set the colour painted behind all tracks, e.g. for letterboxed clips.',
  schema: z.object({ color: z.string().min(3).max(32) }),
  apply: (state, { color }) => ({
    state: { ...state, settings: { ...state.settings, backgroundColor: color } },
    description: `Set background colour to ${color}`,
  }),
});

const setTimelineDuration = defineAction({
  type: 'set_timeline_duration',
  category: 'project',
  summary:
    'Fit the whole timeline to an exact length in seconds by uniformly speeding up or slowing down every clip. Use this for requests like "make the video exactly 30 seconds".',
  schema: z.object({ duration: z.number().min(0.1).max(36000) }),
  apply: (state, { duration }) => {
    let current = 0;
    for (const clip of state.clips) current = Math.max(current, clip.start + clip.duration);
    if (current <= 0) {
      throw new EditorError('nothing_to_do', 'The timeline is empty, so there is nothing to fit.');
    }
    const factor = duration / current;
    const clips = state.clips.map((clip) => {
      const scaled = {
        ...clip,
        start: clip.start * factor,
        duration: clip.duration * factor,
      };
      if (scaled.kind === 'video' || scaled.kind === 'audio') {
        // Media clips change playback speed instead of dropping frames.
        return { ...scaled, speed: clip.kind === 'text' ? 1 : (clip as { speed: number }).speed / factor };
      }
      return scaled;
    });
    return {
      state: { ...state, clips },
      description: `Fitted the timeline to ${duration.toFixed(1)} s (${factor < 1 ? 'sped up' : 'slowed down'} by ${(1 / factor).toFixed(2)}x)`,
    };
  },
});

export const projectActions: AnyActionDef[] = [
  setProjectName,
  setAspectRatio,
  setResolution,
  setFps,
  setBackgroundColor,
  setTimelineDuration,
];
