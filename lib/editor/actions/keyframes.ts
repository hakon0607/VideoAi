import { z } from 'zod';
import type { Keyframe, KeyframeProperty } from '@/types/editor';
import { EASINGS, KEYFRAMABLE_PROPERTIES } from '@/types/editor';
import {
  defineAction,
  idsFor,
  requireUnlockedClip,
  updateClip,
  uuidLike,
  type AnyActionDef,
} from '../action-kit';
import { EditorError } from '../errors';
import { q } from '../time';

const propertySchema = z
  .string()
  .min(1)
  .describe(
    'One of opacity, scale, x, y, rotation, volume — or "effect:<effectId>:<param>" to animate an effect parameter.',
  );

function validateProperty(clip: ReturnType<typeof requireUnlockedClip>, property: string): KeyframeProperty {
  if ((KEYFRAMABLE_PROPERTIES as readonly string[]).includes(property)) return property as KeyframeProperty;
  const match = /^effect:([^:]+):(.+)$/.exec(property);
  if (match) {
    const effect = clip.effects.find((e) => e.id === match[1]);
    if (!effect) {
      throw new EditorError('effect_not_found', `Clip "${clip.name}" has no effect ${match[1]}.`, {
        availableEffectIds: clip.effects.map((e) => e.id),
      });
    }
    if (!(match[2] in effect.params)) {
      throw new EditorError('invalid_parameters', `The ${effect.type} effect has no parameter "${match[2]}".`, {
        allowed: Object.keys(effect.params),
      });
    }
    return property as KeyframeProperty;
  }
  throw new EditorError('invalid_parameters', `"${property}" cannot be keyframed.`, {
    allowed: [...KEYFRAMABLE_PROPERTIES, 'effect:<effectId>:<param>'],
  });
}

const addKeyframe = defineAction({
  type: 'add_keyframe',
  category: 'keyframe',
  summary:
    'Add a single keyframe to a clip. `time` is relative to the start of the clip, in seconds. Two keyframes on the same property animate between their values.',
  schema: z.object({
    clipId: uuidLike,
    keyframeId: uuidLike.optional(),
    property: propertySchema,
    time: z.number().min(0),
    value: z.number(),
    easing: z.enum(EASINGS).default('ease_in_out'),
  }),
  prepare: (params, ctx) => ({ ...params, keyframeId: params.keyframeId ?? ctx.newId() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const property = validateProperty(clip, params.property);
    if (params.time > clip.duration + 0.001) {
      throw new EditorError('invalid_time', `${params.time}s is past the end of "${clip.name}" (${clip.duration}s).`);
    }
    const keyframe: Keyframe = {
      id: params.keyframeId as string,
      property,
      time: q(params.time),
      value: params.value,
      easing: params.easing,
    };
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        keyframes: [...c.keyframes, keyframe].sort((a, b) => a.time - b.time),
      })),
      description: `Keyframed ${property} on "${clip.name}" at ${keyframe.time.toFixed(2)} s`,
    };
  },
});

const animateProperty = defineAction({
  type: 'animate_property',
  category: 'keyframe',
  summary:
    'Animate a property from one value to another over a time span. This is the easiest way to do a zoom-in ("scale" 1 -> 1.3), a pan, a fade or a volume ramp. Times are relative to the start of the clip.',
  schema: z.object({
    clipId: uuidLike,
    property: propertySchema,
    from: z.number(),
    to: z.number(),
    startTime: z.number().min(0).default(0),
    endTime: z.number().min(0).optional().describe('Defaults to the end of the clip.'),
    easing: z.enum(EASINGS).default('ease_in_out'),
    keyframeIds: z.array(uuidLike).length(2).optional(),
  }),
  prepare: (params, ctx) => ({ ...params, keyframeIds: idsFor(params.keyframeIds, 2, ctx) }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const property = validateProperty(clip, params.property);
    const start = q(Math.min(params.startTime, clip.duration));
    const end = q(Math.min(params.endTime ?? clip.duration, clip.duration));
    if (end <= start) {
      throw new EditorError('invalid_range', 'The animation needs to end after it starts.', { start, end });
    }
    const ids = params.keyframeIds as [string, string];
    const kept = clip.keyframes.filter(
      (kf) => kf.property !== property || kf.time < start - 0.001 || kf.time > end + 0.001,
    );
    const keyframes: Keyframe[] = [
      ...kept,
      { id: ids[0], property, time: start, value: params.from, easing: params.easing },
      { id: ids[1], property, time: end, value: params.to, easing: params.easing },
    ].sort((a, b) => a.time - b.time);
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, keyframes })),
      description: `Animated ${property} on "${clip.name}" from ${params.from} to ${params.to}`,
    };
  },
});

const updateKeyframe = defineAction({
  type: 'update_keyframe',
  category: 'keyframe',
  summary: 'Move or re-value an existing keyframe.',
  schema: z.object({
    clipId: uuidLike,
    keyframeId: uuidLike,
    time: z.number().min(0).optional(),
    value: z.number().optional(),
    easing: z.enum(EASINGS).optional(),
  }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const keyframe = clip.keyframes.find((kf) => kf.id === params.keyframeId);
    if (!keyframe) {
      throw new EditorError('keyframe_not_found', `Clip "${clip.name}" has no keyframe ${params.keyframeId}.`);
    }
    const next = {
      ...keyframe,
      time: params.time !== undefined ? q(Math.min(params.time, clip.duration)) : keyframe.time,
      value: params.value ?? keyframe.value,
      easing: params.easing ?? keyframe.easing,
    };
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        keyframes: c.keyframes.map((kf) => (kf.id === next.id ? next : kf)).sort((a, b) => a.time - b.time),
      })),
      description: `Updated a keyframe on "${clip.name}"`,
    };
  },
});

const removeKeyframe = defineAction({
  type: 'remove_keyframe',
  category: 'keyframe',
  summary: 'Delete one keyframe.',
  schema: z.object({ clipId: uuidLike, keyframeId: uuidLike }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!clip.keyframes.some((kf) => kf.id === params.keyframeId)) {
      throw new EditorError('keyframe_not_found', `Clip "${clip.name}" has no keyframe ${params.keyframeId}.`);
    }
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...c,
        keyframes: c.keyframes.filter((kf) => kf.id !== params.keyframeId),
      })),
      description: `Removed a keyframe from "${clip.name}"`,
    };
  },
});

const clearKeyframes = defineAction({
  type: 'clear_keyframes',
  category: 'keyframe',
  summary: 'Remove all keyframes from a clip, or all keyframes for one property.',
  schema: z.object({ clipId: uuidLike, property: propertySchema.optional() }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    const keyframes = params.property ? clip.keyframes.filter((kf) => kf.property !== params.property) : [];
    if (keyframes.length === clip.keyframes.length) {
      throw new EditorError('nothing_to_do', `"${clip.name}" has no matching keyframes.`);
    }
    return {
      state: updateClip(state, clip.id, (c) => ({ ...c, keyframes })),
      description: `Cleared keyframes on "${clip.name}"`,
    };
  },
});

export const keyframeActions: AnyActionDef[] = [
  addKeyframe,
  animateProperty,
  updateKeyframe,
  removeKeyframe,
  clearKeyframes,
];
