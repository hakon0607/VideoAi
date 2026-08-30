import type { Clip, EditorState, Track, TrackKind } from '@/types/editor';
import { clipEnd } from './time';
import { clipFitsTrack, defaultTrack } from './defaults';

/** True when anything already occupies [start, end) on this track. */
export function hasOverlap(
  state: EditorState,
  trackId: string,
  start: number,
  end: number,
  ignoreClipId?: string,
): boolean {
  const tolerance = 0.001;
  return state.clips.some(
    (clip) =>
      clip.trackId === trackId &&
      clip.id !== ignoreClipId &&
      clip.start < end - tolerance &&
      clipEnd(clip) > start + tolerance,
  );
}

export interface Placement {
  trackId: string;
  /** A track that had to be created to make room. */
  createdTrack: Track | null;
}

/**
 * Finds somewhere to put a clip so it is never hidden behind another one.
 *
 * Dropping a second image onto a track that is already busy at that moment
 * would stack them invisibly, so the engine walks up the compatible tracks and,
 * if they are all occupied, adds a new layer. That is what an editor does when
 * you drop two things on the same spot.
 */
export function placeClip(
  state: EditorState,
  preferredTrack: Track,
  clipKind: Clip['kind'],
  start: number,
  end: number,
  newTrackId: string,
  ignoreClipId?: string,
): Placement {
  // A track of the wrong kind is never the answer, however free it is.
  const preferredFits = clipFitsTrack(clipKind, preferredTrack.kind) && !preferredTrack.locked;
  if (preferredFits && !hasOverlap(state, preferredTrack.id, start, end, ignoreClipId)) {
    return { trackId: preferredTrack.id, createdTrack: null };
  }

  const candidates = state.tracks
    .filter((track) => !track.locked && clipFitsTrack(clipKind, track.kind))
    .sort((a, b) => a.index - b.index);

  for (const track of candidates) {
    if (!hasOverlap(state, track.id, start, end, ignoreClipId)) {
      return { trackId: track.id, createdTrack: null };
    }
  }

  // Every compatible track is busy: add a new layer above the highest one.
  const kind: TrackKind = preferredFits ? preferredTrack.kind : defaultTrackKind(clipKind);
  const sameKind = state.tracks.filter((track) => track.kind === kind);
  const index = Math.max(...state.tracks.map((track) => track.index), -1) + 1;
  const created = defaultTrack(newTrackId, kind, index, `${kindLabel(kind)} ${sameKind.length + 1}`);
  created.height = preferredTrack.height;
  return { trackId: created.id, createdTrack: created };
}

/** The track a clip of this kind belongs on when nothing else fits. */
function defaultTrackKind(clipKind: Clip['kind']): TrackKind {
  if (clipKind === 'audio') return 'audio';
  if (clipKind === 'text') return 'text';
  return 'video';
}

function kindLabel(kind: TrackKind): string {
  return { video: 'Video', audio: 'Audio', text: 'Text', overlay: 'Overlay' }[kind];
}

/** The earliest point at or after `from` where the clip fits on this track. */
export function nextFreeSlot(state: EditorState, trackId: string, from: number, duration: number): number {
  const occupied = state.clips
    .filter((clip) => clip.trackId === trackId && clipEnd(clip) > from)
    .sort((a, b) => a.start - b.start);

  let cursor = from;
  for (const clip of occupied) {
    if (clip.start >= cursor + duration - 0.001) break;
    cursor = Math.max(cursor, clipEnd(clip));
  }
  return cursor;
}

/**
 * How far a clip may grow on its own track before it would cover a neighbour.
 * `freeStartOnTrack` is the earliest start, `freeEndOnTrack` the latest end.
 */
export function freeStartOnTrack(state: EditorState, clip: Clip): number {
  let limit = 0;
  for (const other of state.clips) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue;
    const end = clipEnd(other);
    if (end <= clip.start + 0.001) limit = Math.max(limit, end);
  }
  return limit;
}

export function freeEndOnTrack(state: EditorState, clip: Clip): number {
  let limit = Number.POSITIVE_INFINITY;
  for (const other of state.clips) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue;
    if (other.start >= clipEnd(clip) - 0.001) limit = Math.min(limit, other.start);
  }
  return limit;
}
