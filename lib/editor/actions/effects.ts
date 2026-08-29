import { z } from 'zod';
import type { Effect } from '@/types/editor';
import { EFFECT_TYPES, TRANSITION_TYPES } from '@/types/editor';
import {
  defineAction,
  requireUnlockedClip,
  updateClip,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { EFFECT_DEFAULTS, EFFECT_RANGES, defaultTransition } from '../defaults';
import { EditorError } from '../errors';

function clampParams(type: (typeof EFFECT_TYPES)[number], params: Record<string, number>): Record<string, number> {
  const ranges = EFFECT_RANGES[type];
  const out: Record<string, number> = { ...EFFECT_DEFAULTS[type] };
  for (const [key, value] of Object.entries(params)) {
    const range = ranges[key];
    if (!range) {
      throw new EditorError('invalid_parameters', `"${key}" is not a parameter of the ${type} effect.`, {
        allowed: Object.keys(ranges),
      });
    }
    out[key] = Math.min(range[1], Math.max(range[0], value));
  }
  return out;
}

const addEffect = defineAction({
  type: 'add_effect',
  category: 'effect',
  summary:
    'Add a visual effect to a clip. Types: blur (radius px), brightness/contrast/saturation (amount, 1 = unchanged), grayscale/sepia/invert (amount 0..1), hue_rotate (degrees), vignette (amount, softness), sharpen (amount).',
  schema: z.object({
    clipId: uuidLike,
    effectId: uuidLike.optional(),
    type: z.enum(EFFECT_TYPES),
    params: z.record(z.string(), z.number()).default({}),
  }),
  prepare: (params, ctx) => ({ ...params, effectId: params.effectId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (clip.kind === 'audio') throw new EditorError('invalid_parameters', 'Visual effects need a visual clip.');
    if (clip.effects.length >= 12) throw new EditorError('limit_exceeded', 'A clip can hold at most 12 effects.');
    const effect: Effect = {
      id: params.effectId as string,
      type: params.type,
      enabled: true,
      params: clampParams(params.type, params.params),
    };
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, effects: [...c.effects, effect] })),
      description: `Added ${params.type} to "${clip.name}"`,
    };
  },
});

const updateEffect = defineAction({
  type: 'update_effect',
  category: 'effect',
  summary: 'Change the parameters of an effect already on a clip, or enable/disable it.',
  schema: z.object({
    clipId: uuidLike,
    effectId: uuidLike,
    params: z.record(z.string(), z.number()).optional(),
    enabled: z.boolean().optional(),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const effect = clip.effects.find((e) => e.id === params.effectId);
    if (!effect) {
      throw new EditorError('effect_not_found', `Clip "${clip.name}" has no effect ${params.effectId}.`, {
        clipId: clip.id,
        availableEffectIds: clip.effects.map((e) => e.id),
      });
    }
    const next: Effect = {
      ...effect,
      enabled: params.enabled ?? effect.enabled,
      params: params.params ? clampParams(effect.type, { ...effect.params, ...params.params }) : effect.params,
    };
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        effects: c.effects.map((e) => (e.id === next.id ? next : e)),
      })),
      description: `Updated ${effect.type} on "${clip.name}"`,
    };
  },
});

const removeEffect = defineAction({
  type: 'remove_effect',
  category: 'effect',
  summary: 'Remove one effect from a clip.',
  schema: z.object({ clipId: uuidLike, effectId: uuidLike }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!clip.effects.some((e) => e.id === params.effectId)) {
      throw new EditorError('effect_not_found', `Clip "${clip.name}" has no effect ${params.effectId}.`);
    }
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, effects: c.effects.filter((e) => e.id !== params.effectId) })),
      description: `Removed an effect from "${clip.name}"`,
    };
  },
});

const clearEffects = defineAction({
  type: 'clear_effects',
  category: 'effect',
  summary: 'Remove every effect from a clip.',
  schema: z.object({ clipId: uuidLike }),
  apply: (state, { clipId }) => {
    const clip = requireUnlockedClip(state, clipId);
    return {
      state: updateClip(state, clipId, (c) => ({ ...c, effects: [] })),
      description: `Cleared effects on "${clip.name}"`,
    };
  },
});

const addTransition = defineAction({
  type: 'add_transition',
  category: 'transition',
  summary:
    'Put a transition on the start (`in`) or end (`out`) edge of a clip. crossfade/dissolve blend with the neighbouring clip; fade goes through the background colour; slide and wipe take a `direction` of left, right, up or down.',
  schema: z.object({
    clipId: uuidLike,
    position: z.enum(['in', 'out']),
    type: z.enum(TRANSITION_TYPES),
    duration: z.number().min(0.05).max(10).optional(),
    direction: z.enum(['left', 'right', 'up', 'down']).optional(),
    transitionId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({ ...params, transitionId: params.transitionId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (params.type === 'cut') {
      return {
        state: updateClip(state, clip.id, (c) => ({
          ...c,
          [params.position === 'in' ? 'transitionIn' : 'transitionOut']: null,
        })),
        description: `Made the ${params.position} edge of "${clip.name}" a hard cut`,
      };
    }
    const transition = defaultTransition(params.type, params.transitionId as string, params.duration);
    if (params.direction) transition.params = { ...transition.params, direction: params.direction };
    const maxDuration = clip.duration / 2;
    transition.duration = Math.min(transition.duration, maxDuration);
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        [params.position === 'in' ? 'transitionIn' : 'transitionOut']: transition,
      })),
      description: `Added a ${params.type} ${params.position === 'in' ? 'into' : 'out of'} "${clip.name}"`,
    };
  },
});

const removeTransition = defineAction({
  type: 'remove_transition',
  category: 'transition',
  summary: 'Remove the transition from one edge of a clip.',
  schema: z.object({ clipId: uuidLike, position: z.enum(['in', 'out']) }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const key = params.position === 'in' ? 'transitionIn' : 'transitionOut';
    if (!clip[key]) throw new EditorError('transition_not_found', `"${clip.name}" has no ${params.position} transition.`);
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, [key]: null })),
      description: `Removed the ${params.position} transition on "${clip.name}"`,
    };
  },
});

const addTransitionBetween = defineAction({
  type: 'add_transition_between',
  category: 'transition',
  summary:
    'Put a matched transition between two adjacent clips: the outgoing edge of the first and the incoming edge of the second. Use this for "make the cut between these two clips softer".',
  schema: z.object({
    fromClipId: uuidLike,
    toClipId: uuidLike,
    type: z.enum(TRANSITION_TYPES),
    duration: z.number().min(0.05).max(10).default(0.5),
    outId: uuidLike.optional(),
    inId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    outId: params.outId ?? ctx.newId(),
    inId: params.inId ?? ctx.newId(),
  }),
  apply: (state, params) => {
    const from = requireUnlockedClip(state, params.fromClipId);
    const to = requireUnlockedClip(state, params.toClipId);
    const duration = Math.min(params.duration, from.duration / 2, to.duration / 2);
    const outT = params.type === 'cut' ? null : defaultTransition(params.type, params.outId as string, duration);
    const inT = params.type === 'cut' ? null : defaultTransition(params.type, params.inId as string, duration);
    const clips = state.clips.map((c) => {
      if (c.id === from.id) return { ...c, transitionOut: outT };
      if (c.id === to.id) return { ...c, transitionIn: inT };
      return c;
    });
    return {
      state: withClips(state, clips),
      description: `Added a ${params.type} between "${from.name}" and "${to.name}"`,
    };
  },
});

export const effectActions: AnyActionDef[] = [
  addEffect,
  updateEffect,
  removeEffect,
  clearEffects,
  addTransition,
  removeTransition,
  addTransitionBetween,
];
