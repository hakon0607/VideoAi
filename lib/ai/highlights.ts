import type { EditorState, MediaAnalysis } from '@/types/editor';
import { assetRangeToTimeline, type TimelineRange } from './project-context';

export interface Highlight extends TimelineRange {
  score: number;
  text: string;
  reasons: string[];
}

/**
 * Words that tend to sit on the funny or surprising moment, in English and
 * Norwegian. Crude on purpose: this is a shortlist for the model to judge, not
 * a verdict.
 */
const REACTION_WORDS = new Set([
  'haha', 'hahaha', 'lol', 'omg', 'wow', 'woah', 'whoa', 'oh', 'no', 'yes', 'what',
  'seriously', 'literally', 'actually', 'wait', 'stop', 'oops', 'oh_no', 'perfect', 'amazing',
  'hæ', 'oi', 'nei', 'jaaa', 'jaa', 'herregud', 'hæ?', 'seriøst', 'faktisk', 'vent',
  'stopp', 'æsj', 'digg', 'sykt', 'utrolig', 'grisete', 'katastrofe',
]);

const NORMALISE = /[^\p{L}\p{N}]/gu;

interface Window {
  start: number;
  end: number;
  text: string;
  words: number;
}

/**
 * Groups transcript segments into candidate windows of roughly `target`
 * seconds. Short-form editing lives at this scale: long enough to land a joke,
 * short enough that nothing drags.
 */
function buildWindows(analysis: MediaAnalysis, target: number): Window[] {
  const source = analysis.segments.length > 0
    ? analysis.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))
    : analysis.words.map((w) => ({ start: w.start, end: w.end, text: w.word }));

  const windows: Window[] = [];
  let current: Window | null = null;

  for (const item of source) {
    if (!current) {
      current = { start: item.start, end: item.end, text: item.text, words: item.text.split(/\s+/).length };
      continue;
    }
    if (item.end - current.start > target) {
      windows.push(current);
      current = { start: item.start, end: item.end, text: item.text, words: item.text.split(/\s+/).length };
    } else {
      current.end = item.end;
      current.text = `${current.text} ${item.text}`.trim();
      current.words += item.text.split(/\s+/).length;
    }
  }
  if (current) windows.push(current);
  return windows;
}

/** Peak level inside a time range, read off the stored waveform. */
function loudnessIn(analysis: MediaAnalysis, duration: number, start: number, end: number, waveform: number[] | null): number {
  if (!waveform || waveform.length === 0 || duration <= 0) return 0;
  const from = Math.max(0, Math.floor((start / duration) * waveform.length));
  const to = Math.min(waveform.length, Math.ceil((end / duration) * waveform.length));
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let i = from; i < to; i += 1) {
    peak = Math.max(peak, waveform[i]);
    sum += waveform[i];
    count += 1;
  }
  const mean = count > 0 ? sum / count : 0;
  // Peak matters more than average: a laugh is a spike, not a loud stretch.
  return peak * 0.7 + mean * 0.3;
}

function silenceOverlap(analysis: MediaAnalysis, start: number, end: number): number {
  let total = 0;
  for (const span of analysis.silences) {
    const overlap = Math.min(end, span.end) - Math.max(start, span.start);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/**
 * Ranks the moments most worth keeping.
 *
 * The score is a blend of how much is being said, how loud it gets, whether
 * anyone reacts, and how little dead air the window contains. It is a
 * shortlist, not a decision — the assistant reads the text of the top windows
 * and picks. That division of labour is deliberate: heuristics are good at
 * "something happened here", a language model is good at "this is the funny
 * bit".
 */
export function findHighlights(
  state: EditorState,
  options: { targetSeconds?: number; limit?: number; assetId?: string } = {},
): Highlight[] {
  const target = options.targetSeconds ?? 9;
  const limit = options.limit ?? 12;
  const results: Highlight[] = [];

  for (const [assetId, analysis] of Object.entries(state.analysis)) {
    if (options.assetId && assetId !== options.assetId) continue;
    if (analysis.segments.length === 0 && analysis.words.length === 0) continue;

    const asset = state.assets.find((a) => a.id === assetId);
    const waveform = asset?.waveform ?? null;
    const duration = asset?.duration ?? 0;

    const windows = buildWindows(analysis, target);
    if (windows.length === 0) continue;

    const wordRates = windows.map((w) => w.words / Math.max(0.5, w.end - w.start));
    const maxRate = Math.max(...wordRates, 0.001);

    windows.forEach((window, index) => {
      const span = Math.max(0.5, window.end - window.start);
      const reasons: string[] = [];

      const density = wordRates[index] / maxRate;
      if (density > 0.7) reasons.push('dense speech');

      const loudness = loudnessIn(analysis, duration, window.start, window.end, waveform);
      if (loudness > 0.6) reasons.push('loud moment');

      const tokens = window.text.toLowerCase().split(/\s+/).map((t) => t.replace(NORMALISE, ''));
      const reactions = tokens.filter((t) => t && REACTION_WORDS.has(t)).length;
      if (reactions > 0) reasons.push(`${reactions} reaction word${reactions === 1 ? '' : 's'}`);

      const exclamations = (window.text.match(/[!?]/g) ?? []).length;
      if (exclamations > 0) reasons.push('exclamation');

      const dead = silenceOverlap(analysis, window.start, window.end) / span;
      if (dead > 0.35) reasons.push('a lot of dead air');

      const score =
        density * 0.3 +
        loudness * 0.25 +
        Math.min(1, reactions / 2) * 0.25 +
        Math.min(1, exclamations / 2) * 0.1 -
        dead * 0.3;

      for (const range of assetRangeToTimeline(state, assetId, window.start, window.end)) {
        results.push({
          ...range,
          score: Math.round(Math.max(0, score) * 1000) / 1000,
          text: window.text.slice(0, 300),
          reasons,
        });
      }
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Turns a set of chosen highlights into the ranges that should be *removed* to
 * leave only them, in original timeline coordinates.
 */
export function inverseRanges(
  keep: { start: number; end: number }[],
  totalDuration: number,
  padding = 0.15,
): { start: number; end: number }[] {
  const sorted = [...keep]
    .map((r) => ({ start: Math.max(0, r.start - padding), end: Math.min(totalDuration, r.end + padding) }))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const remove: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor + 0.01) remove.push({ start: cursor, end: range.start });
    cursor = range.end;
  }
  if (cursor < totalDuration - 0.01) remove.push({ start: cursor, end: totalDuration });
  return remove;
}
