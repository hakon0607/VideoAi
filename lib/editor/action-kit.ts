import { z } from 'zod';
import type { Clip, EditorState, MediaAsset, Track, UUID } from '@/types/editor';
import { EditorError } from './errors';

export const ACTION_CATEGORIES = [
  'project',
  'track',
  'clip',
  'text',
  'audio',
  'effect',
  'transition',
  'keyframe',
  'media',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export interface ActionContext {
  /** Generates ids for objects the action creates. */
  newId(): string;
}

export interface ActionOutcome {
  state: EditorState;
  /** Short, human readable summary. Shown in history and the AI change log. */
  description: string;
}

export interface ActionDef<Schema extends z.ZodType = z.ZodType> {
  type: string;
  category: ActionCategory;
  schema: Schema;
  /** Explains to the model what the action does and when to use it. */
  summary: string;
  /** Destructive actions ask the user for confirmation before running. */
  destructive?: boolean;
  /**
   * Fills in generated ids before the action runs, so the exact same action can
   * be replayed on another machine (server -> client) with identical results.
   */
  prepare?: (params: z.infer<Schema>, ctx: ActionContext) => z.infer<Schema>;
  apply: (state: EditorState, params: z.infer<Schema>, ctx: ActionContext) => ActionOutcome;
}

// The registry stores actions with different schemas side by side, so the
// concrete parameter type is erased at the boundary and re-established by
// `schema.parse` inside the engine.
export type AnyActionDef = ActionDef<z.ZodType>;

export function defineAction<Schema extends z.ZodType>(def: ActionDef<Schema>): AnyActionDef {
  return def as unknown as AnyActionDef;
}

/** A validated, replayable editor command. */
export interface EditorAction {
  type: string;
  params: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Lookup helpers that throw structured errors                                */
/* -------------------------------------------------------------------------- */

export function requireClip(state: EditorState, clipId: UUID): Clip {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) {
    throw new EditorError('clip_not_found', `No clip with id ${clipId} exists on this timeline.`, {
      clipId,
      availableClipIds: state.clips.slice(0, 40).map((c) => c.id),
    });
  }
  return clip;
}

export function requireUnlockedClip(state: EditorState, clipId: UUID): Clip {
  const clip = requireClip(state, clipId);
  if (clip.locked) {
    throw new EditorError('clip_locked', `Clip "${clip.name}" is locked and cannot be modified.`, { clipId });
  }
  return clip;
}

export function requireTrack(state: EditorState, trackId: UUID): Track {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new EditorError('track_not_found', `No track with id ${trackId} exists.`, {
      trackId,
      availableTrackIds: state.tracks.map((t) => t.id),
    });
  }
  return track;
}

export function requireAsset(state: EditorState, assetId: UUID): MediaAsset {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) {
    throw new EditorError('asset_not_found', `No media asset with id ${assetId} is attached to this project.`, {
      assetId,
      availableAssetIds: state.assets.map((a) => a.id),
    });
  }
  return asset;
}

/* -------------------------------------------------------------------------- */
/* Immutable state helpers                                                    */
/* -------------------------------------------------------------------------- */

export function withClips(state: EditorState, clips: Clip[]): EditorState {
  return { ...state, clips };
}

export function updateClip(state: EditorState, clipId: UUID, updater: (clip: Clip) => Clip): EditorState {
  let found = false;
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    found = true;
    return updater(clip);
  });
  if (!found) throw new EditorError('clip_not_found', `No clip with id ${clipId} exists.`, { clipId });
  return withClips(state, clips);
}

export function updateTrack(state: EditorState, trackId: UUID, updater: (track: Track) => Track): EditorState {
  let found = false;
  const tracks = state.tracks.map((track) => {
    if (track.id !== trackId) return track;
    found = true;
    return updater(track);
  });
  if (!found) throw new EditorError('track_not_found', `No track with id ${trackId} exists.`, { trackId });
  return { ...state, tracks };
}

/* -------------------------------------------------------------------------- */
/* Shared schema fragments                                                    */
/* -------------------------------------------------------------------------- */

export const uuidLike = z
  .string()
  .min(1)
  .describe('An id that already exists in the project state. Never invent one.');

export const seconds = z.number().finite().min(0);
export const optionalId = uuidLike.optional();
