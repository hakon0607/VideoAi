import type { Clip, EditorState, MediaClip, SilenceSpan, TranscriptWord } from '@/types/editor';
import { isMediaClip, isTextClip } from '@/types/editor';
import { clipEnd, q } from '@/lib/editor/time';
import { orderedTracks, timelineDuration } from '@/lib/editor/selectors';

/** Above this many clips the summary collapses caption groups to one line. */
const CLIP_DETAIL_LIMIT = 90;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeClip(clip: Clip): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: clip.id,
    name: clip.name,
    kind: clip.kind,
    start: round(clip.start),
    end: round(clipEnd(clip)),
    duration: round(clip.duration),
  };
  if (clip.locked) base.locked = true;
  if (clip.opacity !== 1) base.opacity = round(clip.opacity, 3);
  const t = clip.transform;
  if (t.x || t.y || t.scale !== 1 || t.rotation || t.flipH || t.flipV) {
    base.transform = {
      x: round(t.x, 3),
      y: round(t.y, 3),
      scale: round(t.scale, 3),
      rotation: round(t.rotation, 1),
      ...(t.flipH ? { flipH: true } : {}),
      ...(t.flipV ? { flipV: true } : {}),
    };
  }
  if (clip.effects.length) {
    base.effects = clip.effects.map((e) => ({ id: e.id, type: e.type, enabled: e.enabled, params: e.params }));
  }
  if (clip.keyframes.length) {
    base.keyframes = clip.keyframes.map((k) => ({
      id: k.id,
      property: k.property,
      time: round(k.time),
      value: round(k.value, 3),
    }));
  }
  if (clip.transitionIn) {
    base.transitionIn = { type: clip.transitionIn.type, duration: round(clip.transitionIn.duration) };
  }
  if (clip.transitionOut) {
    base.transitionOut = { type: clip.transitionOut.type, duration: round(clip.transitionOut.duration) };
  }

  if (isTextClip(clip)) {
    base.text = clip.text;
    base.animation = clip.animation;
    base.fontSize = round(clip.style.fontSize, 3);
    base.color = clip.style.color;
    if (clip.role === 'caption') {
      base.role = 'caption';
      base.captionGroupId = clip.groupId;
    }
    return base;
  }

  const media = clip as MediaClip;
  base.assetId = media.assetId;
  base.sourceIn = round(media.sourceIn);
  if (media.speed !== 1) base.speed = round(media.speed, 3);
  if (media.reversed) base.reversed = true;
  if (media.freeze) base.freeze = true;
  if (media.volume !== 1) base.volume = round(media.volume, 3);
  if (media.muted) base.muted = true;
  if (media.fadeIn) base.fadeIn = round(media.fadeIn);
  if (media.fadeOut) base.fadeOut = round(media.fadeOut);
  if (media.crop) base.crop = media.crop;
  return base;
}

/**
 * The snapshot the model reasons about. Deliberately compact: real ids and real
 * times, no prose, and long caption runs collapsed so a 400-line subtitle track
 * does not crowd out the rest of the project.
 */
export function buildProjectContext(state: EditorState, selection: string[] = [], playhead = 0) {
  const tracks = orderedTracks(state).map((track) => ({
    id: track.id,
    kind: track.kind,
    name: track.name,
    index: track.index,
    ...(track.muted ? { muted: true } : {}),
    ...(track.hidden ? { hidden: true } : {}),
    ...(track.locked ? { locked: true } : {}),
    ...(track.volume !== 1 ? { volume: round(track.volume, 3) } : {}),
    clipCount: state.clips.filter((c) => c.trackId === track.id).length,
  }));

  const captionGroups = new Map<string, { count: number; start: number; end: number; trackId: string }>();
  for (const clip of state.clips) {
    if (clip.role !== 'caption' || !clip.groupId) continue;
    const existing = captionGroups.get(clip.groupId);
    if (existing) {
      existing.count += 1;
      existing.start = Math.min(existing.start, clip.start);
      existing.end = Math.max(existing.end, clipEnd(clip));
    } else {
      captionGroups.set(clip.groupId, {
        count: 1,
        start: clip.start,
        end: clipEnd(clip),
        trackId: clip.trackId,
      });
    }
  }

  const detailed = state.clips.filter((c) => c.role !== 'caption');
  const collapseCaptions = state.clips.length > CLIP_DETAIL_LIMIT && captionGroups.size > 0;
  const clips = (collapseCaptions ? detailed : state.clips)
    .slice()
    .sort((a, b) => a.start - b.start)
    .slice(0, CLIP_DETAIL_LIMIT)
    .map(describeClip);

  const assets = state.assets.map((asset) => {
    const analysis = state.analysis[asset.id];
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      duration: round(asset.duration),
      ...(asset.width ? { resolution: `${asset.width}x${asset.height}` } : {}),
      ...(asset.fps ? { fps: round(asset.fps, 2) } : {}),
      hasAudio: asset.hasAudio,
      transcript: analysis?.words.length ? 'available' : analysis ? 'not_transcribed' : 'no_analysis',
      silenceCount: analysis?.silences.length ?? 0,
      ...(analysis?.loudnessDb != null ? { loudnessDb: round(analysis.loudnessDb, 1) } : {}),
    };
  });

  return {
    project: {
      id: state.projectId,
      name: state.name,
      aspectRatio: state.settings.aspectRatio,
      resolution: `${state.settings.width}x${state.settings.height}`,
      fps: state.settings.fps,
      backgroundColor: state.settings.backgroundColor,
      duration: round(timelineDuration(state)),
    },
    tracks,
    clips,
    ...(collapseCaptions
      ? {
          captionGroups: [...captionGroups.entries()].map(([id, g]) => ({
            groupId: id,
            trackId: g.trackId,
            lines: g.count,
            start: round(g.start),
            end: round(g.end),
          })),
          note: `${state.clips.length - detailed.length} caption clips are collapsed into captionGroups. Use get_clips with role="caption" to inspect them.`,
        }
      : {}),
    assets,
    selection,
    playhead: round(playhead),
    totalClipCount: state.clips.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Asset time <-> timeline time                                               */
/* -------------------------------------------------------------------------- */

export interface TimelineRange {
  start: number;
  end: number;
  clipId: string;
}

/**
 * Maps a range inside a source asset onto the timeline, for every clip that
 * uses that asset. This is what lets the model say "cut these ranges" without
 * ever having to reason about source offsets and speed itself.
 */
export function assetRangeToTimeline(state: EditorState, assetId: string, start: number, end: number): TimelineRange[] {
  const ranges: TimelineRange[] = [];
  for (const clip of state.clips) {
    if (!isMediaClip(clip) || clip.assetId !== assetId || clip.freeze) continue;
    const span = clip.duration * clip.speed;
    const sourceStart = clip.sourceIn;
    const sourceEnd = clip.sourceIn + span;
    const overlapStart = Math.max(start, sourceStart);
    const overlapEnd = Math.min(end, sourceEnd);
    if (overlapEnd <= overlapStart) continue;

    if (clip.reversed) {
      const a = clip.start + (sourceEnd - overlapEnd) / clip.speed;
      const b = clip.start + (sourceEnd - overlapStart) / clip.speed;
      ranges.push({ start: q(a), end: q(b), clipId: clip.id });
    } else {
      const a = clip.start + (overlapStart - sourceStart) / clip.speed;
      const b = clip.start + (overlapEnd - sourceStart) / clip.speed;
      ranges.push({ start: q(a), end: q(b), clipId: clip.id });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Every silence in the project, already expressed in timeline seconds. */
export function timelineSilences(
  state: EditorState,
  minDuration: number,
  assetId?: string,
): TimelineRange[] {
  const result: TimelineRange[] = [];
  for (const [id, analysis] of Object.entries(state.analysis)) {
    if (assetId && id !== assetId) continue;
    for (const span of analysis.silences as SilenceSpan[]) {
      for (const range of assetRangeToTimeline(state, id, span.start, span.end)) {
        if (range.end - range.start >= minDuration) result.push(range);
      }
    }
  }
  return mergeRanges(result);
}

export function mergeRanges(ranges: TimelineRange[]): TimelineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TimelineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 0.001) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Finds words or phrases in the transcript and returns timeline ranges. */
export function findInTranscript(
  state: EditorState,
  query: string,
  options: { padding?: number; assetId?: string } = {},
): (TimelineRange & { text: string; assetId: string })[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const padding = options.padding ?? 0.05;
  const terms = needle.split(/\s+/);
  const hits: (TimelineRange & { text: string; assetId: string })[] = [];

  for (const [assetId, analysis] of Object.entries(state.analysis)) {
    if (options.assetId && assetId !== options.assetId) continue;
    const words: TranscriptWord[] = analysis.words ?? [];
    const normalized = words.map((w) => w.word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));

    for (let i = 0; i <= normalized.length - terms.length; i += 1) {
      let matches = true;
      for (let j = 0; j < terms.length; j += 1) {
        if (normalized[i + j] !== terms[j].replace(/[^\p{L}\p{N}']/gu, '')) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      const startWord = words[i];
      const endWord = words[i + terms.length - 1];
      for (const range of assetRangeToTimeline(
        state,
        assetId,
        Math.max(0, startWord.start - padding),
        endWord.end + padding,
      )) {
        hits.push({
          ...range,
          assetId,
          text: words.slice(i, i + terms.length).map((w) => w.word).join(' '),
        });
      }
    }
  }
  return hits;
}

/** Transcript segments mapped onto timeline time, ready to become captions. */
export function transcriptOnTimeline(
  state: EditorState,
  assetId: string,
  granularity: 'segments' | 'words',
  range?: { start: number; end: number },
) {
  const analysis = state.analysis[assetId];
  if (!analysis) return [];
  const items =
    granularity === 'words'
      ? analysis.words.map((w) => ({ start: w.start, end: w.end, text: w.word }))
      : analysis.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));

  const out: { start: number; end: number; text: string }[] = [];
  for (const item of items) {
    for (const mapped of assetRangeToTimeline(state, assetId, item.start, item.end)) {
      if (range && (mapped.end < range.start || mapped.start > range.end)) continue;
      out.push({ start: mapped.start, end: mapped.end, text: item.text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
