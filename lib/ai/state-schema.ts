import { z } from 'zod';
import type { EditorState } from '@/types/editor';
import { ASPECT_RATIOS } from '@/types/editor';

/**
 * The editor snapshot the client sends with an AI request.
 *
 * It is validated but not trusted for authorisation: the server independently
 * checks that the caller may edit `projectId`, and nothing here is ever written
 * to the database. Persistence still goes through save_timeline under RLS.
 */
const transformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  rotation: z.number(),
  flipH: z.boolean(),
  flipV: z.boolean(),
});

const effectSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
});

const keyframeSchema = z.object({
  id: z.string(),
  property: z.string(),
  time: z.number(),
  value: z.number(),
  easing: z.string(),
});

const transitionSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    duration: z.number(),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .nullable();

const clipSchema = z
  .object({
    id: z.string(),
    trackId: z.string(),
    name: z.string(),
    kind: z.enum(['video', 'audio', 'image', 'text']),
    role: z.enum(['default', 'caption']).default('default'),
    groupId: z.string().nullable().default(null),
    start: z.number(),
    duration: z.number(),
    locked: z.boolean().default(false),
    opacity: z.number().default(1),
    transform: transformSchema,
    effects: z.array(effectSchema).default([]),
    keyframes: z.array(keyframeSchema).default([]),
    transitionIn: transitionSchema.default(null),
    transitionOut: transitionSchema.default(null),
  })
  .catchall(z.unknown());

export const editorStateSchema = z.object({
  projectId: z.string(),
  timelineId: z.string(),
  name: z.string(),
  settings: z.object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    backgroundColor: z.string(),
    sampleRate: z.number(),
  }),
  tracks: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['video', 'audio', 'text', 'overlay']),
      name: z.string(),
      index: z.number(),
      muted: z.boolean(),
      hidden: z.boolean(),
      locked: z.boolean(),
      volume: z.number(),
      height: z.number(),
    }),
  ),
  clips: z.array(clipSchema).max(5000),
  assets: z.array(z.object({ id: z.string() }).catchall(z.unknown())).max(500),
  analysis: z.record(z.string(), z.unknown()).default({}),
  revision: z.number().default(0),
});

export function parseEditorState(value: unknown): EditorState {
  return editorStateSchema.parse(value) as unknown as EditorState;
}
