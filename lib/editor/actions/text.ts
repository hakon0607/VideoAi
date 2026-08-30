import { z } from 'zod';
import type { Clip, TextClip, TextStyle } from '@/types/editor';
import { TEXT_ALIGNS, TEXT_ANIMATIONS, isTextClip } from '@/types/editor';
import {
  defineAction,
  idsFor,
  requireTrack,
  requireUnlockedClip,
  updateClip,
  uuidLike,
  withClips,
  type AnyActionDef,
} from '../action-kit';
import { baseClipFields, captionTextStyle, defaultTextStyle } from '../defaults';
import { placeClip } from '../placement';
import { EditorError } from '../errors';
import { q } from '../time';

const textStyleSchema = z.object({
  fontFamily: z.string().min(1).max(120).optional(),
  fontSize: z.number().min(0.005).max(0.5).optional().describe('Fraction of frame height. 0.07 is a normal title.'),
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  color: z.string().min(3).max(32).optional(),
  align: z.enum(TEXT_ALIGNS).optional(),
  lineHeight: z.number().min(0.6).max(3).optional(),
  letterSpacing: z.number().min(-0.2).max(0.5).optional(),
  backgroundColor: z.string().min(3).max(40).optional(),
  backgroundPadding: z.number().min(0).max(0.2).optional(),
  backgroundRadius: z.number().min(0).max(0.2).optional(),
  strokeColor: z.string().min(3).max(32).optional(),
  strokeWidth: z.number().min(0).max(0.05).optional(),
  shadowColor: z.string().min(3).max(40).optional(),
  shadowBlur: z.number().min(0).max(0.2).optional(),
  shadowOffsetY: z.number().min(-0.2).max(0.2).optional(),
  maxWidth: z.number().min(0.1).max(1).optional(),
  uppercase: z.boolean().optional(),
});

function mergeStyle(base: TextStyle, patch: z.infer<typeof textStyleSchema>): TextStyle {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

const addText = defineAction({
  type: 'add_text',
  category: 'text',
  summary:
    'Add a text clip (title, lower third, caption line) to a text or overlay track. Position it with `set_transform` afterwards; y = -0.3 is upper third, y = 0.35 is lower third.',
  schema: z.object({
    clipId: uuidLike.optional(),
    trackId: uuidLike,
    text: z.string().min(1).max(2000),
    start: z.number().min(0),
    duration: z.number().min(0.1).max(3600).default(3),
    animation: z.enum(TEXT_ANIMATIONS).default('fade'),
    style: textStyleSchema.optional(),
    x: z.number().min(-2).max(2).optional(),
    y: z.number().min(-2).max(2).optional(),
    newTrackId: uuidLike.optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    clipId: params.clipId ?? ctx.newId(),
    newTrackId: params.newTrackId ?? ctx.newId(),
  }),
  apply: (state, params) => {
    const track = requireTrack(state, params.trackId);
    if (track.kind !== 'text' && track.kind !== 'overlay') {
      throw new EditorError('incompatible_track', 'Text clips need a text or overlay track.', {
        trackId: track.id,
        trackKind: track.kind,
      });
    }
    const start = q(params.start);
    const duration = q(params.duration);
    // Text moves to a free lane, adding one if needed, rather than covering
    // text that is already on screen at that moment.
    const placement = placeClip(state, track, 'text', start, start + duration, params.newTrackId as string);

    const base = baseClipFields(
      params.clipId as string,
      placement.trackId,
      start,
      duration,
      params.text.slice(0, 40),
    );
    const clip: TextClip = {
      ...base,
      kind: 'text',
      text: params.text,
      style: params.style ? mergeStyle(defaultTextStyle(), params.style) : defaultTextStyle(),
      animation: params.animation,
      transform: { ...base.transform, x: params.x ?? 0, y: params.y ?? 0 },
    };
    const next = placement.createdTrack
      ? { ...state, tracks: [...state.tracks, placement.createdTrack] }
      : state;
    return {
      state: withClips(next, [...next.clips, clip]),
      description: `Added text "${params.text.slice(0, 40)}"`,
    };
  },
});

const setTextContent = defineAction({
  type: 'set_text_content',
  category: 'text',
  summary: 'Replace the words in a text clip.',
  schema: z.object({ clipId: uuidLike, text: z.string().min(1).max(2000) }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isTextClip(clip)) throw new EditorError('invalid_parameters', 'That clip is not a text clip.');
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as TextClip), text: params.text })),
      description: `Changed text to "${params.text.slice(0, 40)}"`,
    };
  },
});

const setTextStyle = defineAction({
  type: 'set_text_style',
  category: 'text',
  summary:
    'Change font, size, weight, colour, alignment, outline, shadow or background box of a text clip. Only the fields you pass are changed.',
  schema: z.object({ clipId: uuidLike, style: textStyleSchema }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isTextClip(clip)) throw new EditorError('invalid_parameters', 'That clip is not a text clip.');
    return {
      state: updateClip(state, clip.id, (c) => ({
        ...(c as TextClip),
        style: mergeStyle((c as TextClip).style, params.style),
      })),
      description: `Restyled "${clip.name}"`,
    };
  },
});

const setTextAnimation = defineAction({
  type: 'set_text_animation',
  category: 'text',
  summary: 'Set the entrance animation for a text clip.',
  schema: z.object({ clipId: uuidLike, animation: z.enum(TEXT_ANIMATIONS) }),
  apply: (state, params) => {
    const clip = requireUnlockedClip(state, params.clipId);
    if (!isTextClip(clip)) throw new EditorError('invalid_parameters', 'That clip is not a text clip.');
    return {
      state: updateClip(state, clip.id, (c) => ({ ...(c as TextClip), animation: params.animation })),
      description: `Set "${clip.name}" animation to ${params.animation}`,
    };
  },
});

const addCaptions = defineAction({
  type: 'add_captions',
  category: 'text',
  summary:
    'Add a whole batch of caption lines at once, each with its own start and end. Get the timings from `get_transcript`. All lines share one group id so they can be restyled or removed together.',
  schema: z.object({
    trackId: uuidLike,
    groupId: uuidLike.optional(),
    lines: z
      .array(
        z.object({
          start: z.number().min(0),
          end: z.number().min(0),
          text: z.string().min(1).max(400),
        }),
      )
      .min(1)
      .max(2000),
    style: textStyleSchema.optional(),
    animation: z.enum(TEXT_ANIMATIONS).default('none'),
    /** Vertical position; 0.35 sits in the lower third, 0 is dead centre. */
    y: z.number().min(-1).max(1).default(0.33),
    clipIds: z.array(uuidLike).optional(),
    newTrackIds: z.array(uuidLike).optional(),
  }),
  prepare: (params, ctx) => ({
    ...params,
    groupId: params.groupId ?? ctx.newId(),
    clipIds: idsFor(params.clipIds, params.lines.length, ctx),
    // A small pool of ids for lanes the batch may have to create; unused ones
    // cost nothing and keep the action replayable on another machine.
    newTrackIds: idsFor(params.newTrackIds, 8, ctx),
  }),
  apply: (state, params) => {
    const track = requireTrack(state, params.trackId);
    if (track.kind !== 'text' && track.kind !== 'overlay') {
      throw new EditorError('incompatible_track', 'Captions need a text or overlay track.', { trackId: track.id });
    }
    const style = params.style ? mergeStyle(captionTextStyle(), params.style) : captionTextStyle();
    const ids = params.clipIds as string[];
    const lanePool = params.newTrackIds as string[];

    // Captions land beside whatever is already on the track rather than on top
    // of it — a title in the same seconds must stay visible.
    let working = state;
    let laneIndex = 0;
    const clips: Clip[] = [];
    params.lines.forEach((line, i) => {
      const start = q(line.start);
      const duration = Math.max(0.1, q(line.end - line.start));
      if (laneIndex >= lanePool.length) {
        throw new EditorError(
          'limit_exceeded',
          'These caption lines overlap in too many layers. Split them into separate calls, or check the timings.',
          { lines: params.lines.length },
        );
      }
      const placement = placeClip(working, track, 'text', start, start + duration, lanePool[laneIndex]);
      if (placement.createdTrack) {
        working = { ...working, tracks: [...working.tracks, placement.createdTrack] };
        laneIndex += 1;
      }
      const base = baseClipFields(ids[i], placement.trackId, start, duration, line.text.slice(0, 30));
      const clip: Clip = {
        ...base,
        kind: 'text' as const,
        text: line.text,
        style,
        animation: params.animation,
        role: 'caption' as const,
        groupId: params.groupId as string,
        transform: { ...base.transform, y: params.y },
      };
      clips.push(clip);
      working = { ...working, clips: [...working.clips, clip] };
    });

    return {
      state: withClips(working, working.clips),
      description: `Added ${clips.length} caption lines`,
    };
  },
});

const removeCaptions = defineAction({
  type: 'remove_captions',
  category: 'text',
  summary: 'Delete every caption line belonging to a caption group.',
  schema: z.object({ groupId: uuidLike }),
  apply: (state, { groupId }) => {
    const removed = state.clips.filter((c) => c.groupId === groupId).length;
    if (removed === 0) throw new EditorError('nothing_to_do', `No captions with group id ${groupId}.`, { groupId });
    return {
      state: withClips(state, state.clips.filter((c) => c.groupId !== groupId)),
      description: `Removed ${removed} caption lines`,
    };
  },
});

const restyleCaptions = defineAction({
  type: 'restyle_captions',
  category: 'text',
  summary: 'Change the look of every caption line in a group at once.',
  schema: z.object({
    groupId: uuidLike,
    style: textStyleSchema,
    y: z.number().min(-1).max(1).optional(),
    animation: z.enum(TEXT_ANIMATIONS).optional(),
  }),
  apply: (state, params) => {
    let count = 0;
    const clips = state.clips.map((c) => {
      if (c.groupId !== params.groupId || !isTextClip(c)) return c;
      count += 1;
      return {
        ...c,
        style: mergeStyle(c.style, params.style),
        animation: params.animation ?? c.animation,
        transform: params.y !== undefined ? { ...c.transform, y: params.y } : c.transform,
      };
    });
    if (count === 0) throw new EditorError('nothing_to_do', `No captions with group id ${params.groupId}.`);
    return { state: withClips(state, clips), description: `Restyled ${count} caption lines` };
  },
});

export const textActions: AnyActionDef[] = [
  addText,
  setTextContent,
  setTextStyle,
  setTextAnimation,
  addCaptions,
  removeCaptions,
  restyleCaptions,
];
