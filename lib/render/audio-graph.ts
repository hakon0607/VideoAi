import type { AudioFilter, EditorState, MediaClip } from '@/types/editor';
import { isMediaClip } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { getTrack } from '@/lib/editor/selectors';

export interface FilterSpec {
  type: BiquadFilterType;
  frequency: number;
  /** Q for band filters, or the shelf/peak slope. */
  q?: number;
  gainDb?: number;
}

/**
 * What each filter preset actually does.
 *
 * These are ordinary biquad chains, so they run identically in the preview's
 * live AudioContext and in the exporter's OfflineAudioContext — the exported
 * file sounds like what you heard.
 */
export const FILTER_CHAINS: Record<AudioFilter, FilterSpec[]> = {
  none: [],
  // Roll off rumble, then lift the presence band where consonants live.
  voice: [
    { type: 'highpass', frequency: 90, q: 0.7 },
    { type: 'peaking', frequency: 3000, q: 1.1, gainDb: 4 },
    { type: 'highshelf', frequency: 8000, gainDb: 2 },
  ],
  lowpass: [{ type: 'lowpass', frequency: 1200, q: 0.8 }],
  highpass: [{ type: 'highpass', frequency: 400, q: 0.8 }],
  // The classic 300–3400 Hz telephone band.
  telephone: [
    { type: 'highpass', frequency: 300, q: 1 },
    { type: 'lowpass', frequency: 3400, q: 1 },
    { type: 'peaking', frequency: 1800, q: 2, gainDb: 6 },
  ],
  radio: [
    { type: 'highpass', frequency: 200, q: 1 },
    { type: 'lowpass', frequency: 5000, q: 1 },
    { type: 'peaking', frequency: 2400, q: 1.4, gainDb: 5 },
  ],
  warm: [
    { type: 'lowshelf', frequency: 220, gainDb: 3 },
    { type: 'highshelf', frequency: 8000, gainDb: -2.5 },
  ],
};

export const FILTER_LABELS: Record<AudioFilter, string> = {
  none: 'No filter',
  voice: 'Voice clarity',
  lowpass: 'Muffled (behind a wall)',
  highpass: 'Thin (no bass)',
  telephone: 'Telephone',
  radio: 'Old radio',
  warm: 'Warm',
};

/**
 * Builds the biquad chain on a context and returns its endpoints.
 * Returns null when the preset is `none`, so callers can skip the plumbing.
 */
export function buildFilterChain(
  context: BaseAudioContext,
  filter: AudioFilter,
): { input: AudioNode; output: AudioNode } | null {
  const specs = FILTER_CHAINS[filter];
  if (!specs || specs.length === 0) return null;

  let first: AudioNode | null = null;
  let previous: AudioNode | null = null;

  for (const spec of specs) {
    const node = context.createBiquadFilter();
    node.type = spec.type;
    node.frequency.value = spec.frequency;
    if (spec.q !== undefined) node.Q.value = spec.q;
    if (spec.gainDb !== undefined) node.gain.value = spec.gainDb;
    if (!first) first = node;
    if (previous) previous.connect(node);
    previous = node;
  }

  return first && previous ? { input: first, output: previous } : null;
}

/**
 * A compressor tuned by a single 0..1 dial.
 *
 * At 0 it does nothing; at 1 it flattens a recording where one person leans
 * into the mic and the other does not.
 */
export function buildCompressor(context: BaseAudioContext, amount: number): DynamicsCompressorNode | null {
  if (amount <= 0.001) return null;
  const node = context.createDynamicsCompressor();
  node.threshold.value = -12 - amount * 24;
  node.knee.value = 12;
  node.ratio.value = 2 + amount * 10;
  node.attack.value = 0.006;
  node.release.value = 0.18;
  return node;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/* -------------------------------------------------------------------------- */
/* Ducking                                                                    */
/* -------------------------------------------------------------------------- */

const DUCK_ATTACK = 0.12;
const DUCK_RELEASE = 0.35;

/**
 * How much a clip should be turned down at `time` because something is playing
 * on a track it ducks under.
 *
 * Returns 1 when nothing is happening and `1 - duckAmount` while speech is.
 * The ramps are what stop it sounding like a switch being flicked.
 */
export function duckFactorAt(state: EditorState, clip: MediaClip, time: number): number {
  const trackIds = clip.audio.duckUnderTrackIds;
  if (!trackIds || trackIds.length === 0) return 1;

  const targets = new Set(trackIds);
  let closest = Number.POSITIVE_INFINITY;
  let inside = false;

  for (const other of state.clips) {
    if (!isMediaClip(other) || other.id === clip.id || !targets.has(other.trackId)) continue;
    if (other.muted) continue;
    const track = getTrack(state, other.trackId);
    if (track?.muted) continue;

    const start = other.start;
    const end = clipEnd(other);
    if (time >= start && time < end) {
      inside = true;
      // How close are we to the edges? Used for the release ramp.
      closest = Math.min(closest, Math.min(time - start, end - time));
      break;
    }
    if (time < start) closest = Math.min(closest, start - time);
    else closest = Math.min(closest, time - end);
  }

  const amount = Math.min(1, Math.max(0, clip.audio.duckAmount));
  if (inside) {
    // Ease in over the attack window so the dip is not a click.
    const ramp = Math.min(1, closest / DUCK_ATTACK);
    return 1 - amount * ramp;
  }
  if (closest < DUCK_RELEASE) {
    const ramp = 1 - closest / DUCK_RELEASE;
    return 1 - amount * ramp;
  }
  return 1;
}

/** Tracks that carry speech, used as the default ducking target. */
export function likelySpeechTracks(state: EditorState): string[] {
  const withTranscript = new Set<string>();
  for (const clip of state.clips) {
    if (!isMediaClip(clip) || clip.kind === 'image') continue;
    const analysis = state.analysis[clip.assetId];
    if (analysis && analysis.words.length > 0) withTranscript.add(clip.trackId);
  }
  if (withTranscript.size > 0) return [...withTranscript];
  // No transcript yet: video tracks are the best guess for where the talking is.
  return state.tracks.filter((track) => track.kind === 'video').map((track) => track.id);
}
