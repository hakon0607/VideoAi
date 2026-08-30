import type { EditorState } from '@/types/editor';
import { MIN_CLIP_DURATION } from './clip-ops';
import { clipFitsTrack } from './defaults';
import { EditorError } from './errors';

/**
 * The post-condition every action has to satisfy.
 *
 * Each action is written to keep the timeline consistent, but the parameters
 * come from a language model as often as from a mouse, and a plausible-looking
 * id can be one that already exists. Rather than trusting seventy separate
 * implementations to think of that, the engine checks the result of every
 * action against the handful of things the renderer, the timeline and the
 * database all assume — duplicate ids would break the primary keys on save,
 * a clip on a missing track would never draw, a NaN duration would poison the
 * whole ruler.
 *
 * A violation rejects the action (and, in a batch, the whole transaction), so
 * a bad parameter is a clean error message instead of a corrupt project.
 */
export function assertIntegrity(state: EditorState, actionType: string): void {
  const fail = (message: string, details?: Record<string, unknown>): never => {
    throw new EditorError('invalid_parameters', `${actionType} would corrupt the timeline: ${message}`, details);
  };

  const trackKinds = new Map<string, string>();
  for (const track of state.tracks) {
    if (typeof track.id !== 'string' || track.id.length === 0) fail('a track has no id');
    if (trackKinds.has(track.id)) fail(`two tracks share the id ${track.id}`, { trackId: track.id });
    trackKinds.set(track.id, track.kind);
    if (!Number.isFinite(track.index)) fail(`track "${track.name}" has a non-numeric index`);
    if (!Number.isFinite(track.volume)) fail(`track "${track.name}" has a non-numeric volume`);
  }

  const assetIds = new Set<string>();
  for (const asset of state.assets) {
    if (typeof asset.id !== 'string' || asset.id.length === 0) fail('an asset has no id');
    if (assetIds.has(asset.id)) fail(`two assets share the id ${asset.id}`, { assetId: asset.id });
    assetIds.add(asset.id);
  }

  const clipIds = new Set<string>();
  for (const clip of state.clips) {
    if (typeof clip.id !== 'string' || clip.id.length === 0) fail(`a ${clip.kind} clip has no id`);
    if (clipIds.has(clip.id)) fail(`two clips share the id ${clip.id}`, { clipId: clip.id });
    clipIds.add(clip.id);

    const trackKind = trackKinds.get(clip.trackId);
    if (!trackKind) fail(`clip "${clip.name}" sits on a track that does not exist`, { clipId: clip.id });
    if (!clipFitsTrack(clip.kind, trackKind as never)) {
      fail(`a ${clip.kind} clip cannot sit on a ${trackKind} track`, { clipId: clip.id, trackId: clip.trackId });
    }
    if (!Number.isFinite(clip.start) || clip.start < 0) fail(`clip "${clip.name}" has an invalid start`, { clipId: clip.id });
    // Shorter than a frame is not a clip, it is a rounding error — and one
    // that would slip through every overlap check.
    if (!Number.isFinite(clip.duration) || clip.duration < MIN_CLIP_DURATION - 1e-9) {
      fail(`clip "${clip.name}" would be too short to see`, { clipId: clip.id, duration: clip.duration });
    }
    if (clip.kind !== 'text') {
      if (!assetIds.has(clip.assetId)) fail(`clip "${clip.name}" points at media that is not in the project`, { clipId: clip.id });
      if (!Number.isFinite(clip.speed) || clip.speed <= 0) fail(`clip "${clip.name}" has an invalid speed`, { clipId: clip.id });
      if (!Number.isFinite(clip.sourceIn) || clip.sourceIn < 0) fail(`clip "${clip.name}" has an invalid in-point`, { clipId: clip.id });
      if (!Number.isFinite(clip.volume)) fail(`clip "${clip.name}" has an invalid volume`, { clipId: clip.id });
    }

    const keyframeIds = new Set<string>();
    for (const keyframe of clip.keyframes) {
      if (typeof keyframe.id !== 'string' || keyframe.id.length === 0) fail(`clip "${clip.name}" has a keyframe with no id`, { clipId: clip.id });
      if (keyframeIds.has(keyframe.id)) fail(`two keyframes share the id ${keyframe.id}`, { clipId: clip.id });
      keyframeIds.add(keyframe.id);
      if (!Number.isFinite(keyframe.time) || !Number.isFinite(keyframe.value)) {
        fail(`clip "${clip.name}" has a keyframe with a non-numeric value`, { clipId: clip.id });
      }
    }

    const effectIds = new Set<string>();
    for (const effect of clip.effects) {
      if (typeof effect.id !== 'string' || effect.id.length === 0) fail(`clip "${clip.name}" has an effect with no id`, { clipId: clip.id });
      if (effectIds.has(effect.id)) fail(`two effects share the id ${effect.id}`, { clipId: clip.id });
      effectIds.add(effect.id);
      for (const [key, value] of Object.entries(effect.params)) {
        if (!Number.isFinite(value)) fail(`effect ${effect.type} has a non-numeric ${key}`, { clipId: clip.id });
      }
    }
  }

  const markerIds = new Set<string>();
  for (const marker of state.markers) {
    if (markerIds.has(marker.id)) fail(`two markers share the id ${marker.id}`, { markerId: marker.id });
    markerIds.add(marker.id);
    if (!Number.isFinite(marker.time) || marker.time < 0) fail('a marker has an invalid time', { markerId: marker.id });
  }

  const folderIds = new Set<string>();
  for (const folder of state.folders) {
    if (folderIds.has(folder.id)) fail(`two folders share the id ${folder.id}`, { folderId: folder.id });
    folderIds.add(folder.id);
  }
  for (const folder of state.folders) {
    if (folder.parentId && !folderIds.has(folder.parentId)) {
      fail(`folder "${folder.name}" is inside a folder that does not exist`, { folderId: folder.id });
    }
    // A folder that is its own ancestor would loop the breadcrumb forever.
    const seen = new Set<string>([folder.id]);
    let cursor = folder.parentId;
    while (cursor) {
      if (seen.has(cursor)) fail(`folder "${folder.name}" is inside itself`, { folderId: folder.id });
      seen.add(cursor);
      cursor = state.folders.find((f) => f.id === cursor)?.parentId ?? null;
    }
  }
}
