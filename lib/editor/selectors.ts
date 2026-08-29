import type {
  Clip,
  EditorState,
  MediaAsset,
  MediaClip,
  Track,
  UUID,
} from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { clipEnd, q } from './time';

export function getTrack(state: EditorState, trackId: UUID): Track | undefined {
  return state.tracks.find((t) => t.id === trackId);
}

export function getClip(state: EditorState, clipId: UUID): Clip | undefined {
  return state.clips.find((c) => c.id === clipId);
}

export function getAsset(state: EditorState, assetId: UUID): MediaAsset | undefined {
  return state.assets.find((a) => a.id === assetId);
}

export function clipsOnTrack(state: EditorState, trackId: UUID): Clip[] {
  return state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** Tracks bottom-to-top, i.e. render order. */
export function orderedTracks(state: EditorState): Track[] {
  return [...state.tracks].sort((a, b) => a.index - b.index);
}

export function timelineDuration(state: EditorState): number {
  let end = 0;
  for (const clip of state.clips) end = Math.max(end, clipEnd(clip));
  return q(end);
}

export function clipsAtTime(state: EditorState, time: number): Clip[] {
  return state.clips.filter((c) => time >= c.start && time < clipEnd(c));
}

/** Visible clips at a timestamp, in draw order (bottom track first). */
export function visibleClipsAtTime(state: EditorState, time: number): Clip[] {
  const trackIndex = new Map(state.tracks.map((t) => [t.id, t.index]));
  return state.clips
    .filter((c) => c.kind !== 'audio')
    .filter((c) => {
      const track = getTrack(state, c.trackId);
      if (!track || track.hidden) return false;
      const inWindow = time >= c.start - (c.transitionIn?.duration ?? 0) && time < clipEnd(c) + (c.transitionOut?.duration ?? 0);
      return inWindow;
    })
    .sort((a, b) => (trackIndex.get(a.trackId) ?? 0) - (trackIndex.get(b.trackId) ?? 0) || a.start - b.start);
}

export function audibleClipsAtTime(state: EditorState, time: number): MediaClip[] {
  return state.clips.filter((c): c is MediaClip => {
    if (!isMediaClip(c) || c.kind === 'image') return false;
    const track = getTrack(state, c.trackId);
    if (!track || track.muted) return false;
    return time >= c.start && time < clipEnd(c);
  });
}

/** The clip immediately before `clip` on the same track, if any. */
export function previousClip(state: EditorState, clip: Clip): Clip | undefined {
  const siblings = clipsOnTrack(state, clip.trackId);
  const index = siblings.findIndex((c) => c.id === clip.id);
  return index > 0 ? siblings[index - 1] : undefined;
}

export function nextClip(state: EditorState, clip: Clip): Clip | undefined {
  const siblings = clipsOnTrack(state, clip.trackId);
  const index = siblings.findIndex((c) => c.id === clip.id);
  return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
}

/** True when the two clips touch, which is what a transition needs. */
export function clipsAreAdjacent(a: Clip, b: Clip, tolerance = 0.001): boolean {
  return Math.abs(clipEnd(a) - b.start) <= tolerance || Math.abs(clipEnd(b) - a.start) <= tolerance;
}

export function findFreeSlot(state: EditorState, trackId: UUID, _duration = 0): number {
  const clips = clipsOnTrack(state, trackId);
  if (clips.length === 0) return 0;
  const last = clips[clips.length - 1];
  return clipEnd(last);
}

/** Every gap on a track that is at least `minGap` seconds long. */
export function gapsOnTrack(state: EditorState, trackId: UUID, minGap = 0.001): { start: number; end: number }[] {
  const clips = clipsOnTrack(state, trackId);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start - cursor >= minGap) gaps.push({ start: q(cursor), end: q(clip.start) });
    cursor = Math.max(cursor, clipEnd(clip));
  }
  return gaps;
}

export function projectStats(state: EditorState) {
  return {
    tracks: state.tracks.length,
    clips: state.clips.length,
    assets: state.assets.length,
    duration: timelineDuration(state),
  };
}
