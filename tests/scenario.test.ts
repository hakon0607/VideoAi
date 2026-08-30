/**
 * The flexibility test.
 *
 * These are not unit tests of one function; they replay whole requests the way
 * the assistant would — "make this good for TikTok", "cut the boring bits",
 * "punch up the reactions" — as one batch of registry actions, and check the
 * timeline that comes out. If a future change makes a request impossible to
 * express, one of these fails.
 */
import { describe, expect, it } from 'vitest';
import type { EditorState, MediaAnalysis, MediaClip, TextClip } from '@/types/editor';
import { emptyState } from '@/lib/editor/defaults';
import { applyActions } from '@/lib/editor/engine';
import { clipEnd } from '@/lib/editor/time';
import { timelineDuration } from '@/lib/editor/selectors';
import { findHighlights, inverseRanges } from '@/lib/ai/highlights';
import { testContext, TRACK_IDS, videoAsset } from './helpers';

/* -------------------------------------------------------------------------- */
/* A twelve-minute baking video with three friends                            */
/* -------------------------------------------------------------------------- */

const LINES: { text: string; start: number; dead?: boolean }[] = [];
{
  // Twelve minutes: mostly quiet working, with bursts of talking and laughter.
  const chatter = [
    'ok da begynner vi med smøret',
    'nei nei nei det renner utover',
    'hahaha se på det ansiktet ditt',
    'oi det der var faktisk ganske bra',
    'hvor mye mel skal vi ha oppi',
    'seriøst du klarte å søle igjen',
    'wow den ble faktisk perfekt',
    'nå smaker vi',
    'det der var utrolig godt',
    'vi må gjøre dette igjen neste uke',
  ];
  let t = 0;
  for (let i = 0; i < chatter.length; i += 1) {
    // A long quiet stretch, then a burst of speech.
    t += 55;
    LINES.push({ text: chatter[i], start: t });
    LINES.push({ text: 'ja ikke sant altså helt sykt', start: t + 3.2 });
  }
}

function bakingAnalysis(assetId: string, duration: number): MediaAnalysis {
  const words: MediaAnalysis['words'] = [];
  const segments: MediaAnalysis['segments'] = [];
  LINES.forEach((line, index) => {
    const pieces = line.text.split(' ');
    const per = 2.6 / pieces.length;
    pieces.forEach((word, wordIndex) => {
      words.push({
        word,
        start: line.start + wordIndex * per,
        end: line.start + (wordIndex + 1) * per,
      });
    });
    segments.push({ id: index, start: line.start, end: line.start + 2.6, text: line.text });
  });

  // Everything that is not a segment is dead air.
  const silences: MediaAnalysis['silences'] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.start > cursor + 0.6) silences.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (duration > cursor + 0.6) silences.push({ start: cursor, end: duration });

  return {
    assetId,
    language: 'no',
    text: LINES.map((l) => l.text).join(' '),
    words,
    segments,
    silences,
    loudnessDb: -19.4,
    createdAt: new Date(0).toISOString(),
  };
}

function bakingProject(): EditorState {
  const duration = 12 * 60;
  const asset = { ...videoAsset('a55b1111-1111-4111-8111-111111111111', duration), name: 'baking-med-vennene.mp4' };
  const base = emptyState('project-baking', 'timeline-baking', 'Baking', TRACK_IDS);
  const state: EditorState = {
    ...base,
    assets: [asset],
    analysis: { [asset.id]: bakingAnalysis(asset.id, duration) },
  };
  return applyActions(
    state,
    [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: asset.id } }],
    testContext(),
  ).state;
}

describe('scenario: "lag denne bra for TikTok"', () => {
  it('turns a twelve-minute bake-along into a vertical short in one transaction', () => {
    const project = bakingProject();
    const analysis = project.analysis['a55b1111-1111-4111-8111-111111111111'];
    expect(analysis.silences.length).toBeGreaterThan(8);

    // 1. What the assistant reads before it touches anything.
    const highlights = findHighlights(project, { targetSeconds: 6, limit: 7 });
    expect(highlights.length).toBeGreaterThan(3);
    // The laughter and the "wow" moments should outrank the quiet stretches.
    expect(highlights[0].score).toBeGreaterThan(0);

    const keep = highlights.slice(0, 6).sort((a, b) => a.start - b.start);
    const remove = inverseRanges(keep, timelineDuration(project), 0.2);
    expect(remove.length).toBeGreaterThan(0);

    // 2. One batch — the whole edit, exactly as the assistant would send it.
    const ctx = testContext();
    const captionTrack = TRACK_IDS[2];
    const result = applyActions(
      project,
      [
        { type: 'set_aspect_ratio', params: { aspectRatio: '9:16' } },
        { type: 'remove_ranges', params: { ranges: remove, ripple: true } },
        {
          type: 'add_captions',
          params: {
            trackId: captionTrack,
            animation: 'karaoke',
            lines: keep.slice(0, 4).map((highlight, index) => ({
              start: index * 4,
              end: index * 4 + 3.4,
              text: highlight.text?.slice(0, 60) || 'baking',
            })),
          },
        },
        { type: 'add_sound_effect', params: { sound: 'whoosh', start: 0.2 } },
        { type: 'add_sound_effect', params: { sound: 'record_scratch', start: 6.5 } },
        { type: 'add_sound_effect', params: { sound: 'ding', start: 11 } },
        { type: 'add_sticker', params: { emoji: '🔥', start: 2, duration: 1.6, size: 0.2 } },
        { type: 'add_zoom_punch', params: { clipId: project.clips[0].id, at: 3.5, scale: 1.3 } },
        { type: 'apply_effect_to_clips', params: { clipIds: [project.clips[0].id], type: 'saturation', params: { amount: 1.15 } } },
        { type: 'enhance_voice', params: { clipIds: [project.clips[0].id], strength: 0.7 } },
      ],
      ctx,
    );

    const after = result.state;

    // Vertical, shorter, and still coherent.
    expect(after.settings.aspectRatio).toBe('9:16');
    expect(after.settings.width).toBeLessThan(after.settings.height);
    expect(timelineDuration(after)).toBeLessThan(timelineDuration(project) / 3);

    // Captions, stickers, sounds and effects all landed.
    const texts = after.clips.filter((c): c is TextClip => c.kind === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(5); // 4 captions + sticker
    expect(texts.some((c) => c.animation === 'karaoke')).toBe(true);
    expect(texts.some((c) => c.text === '🔥')).toBe(true);

    const sfxAssets = after.assets.filter((a) => a.storagePath.startsWith('sfx:'));
    expect(sfxAssets.map((a) => a.storagePath).sort()).toEqual(['sfx:ding', 'sfx:record_scratch', 'sfx:whoosh']);

    const source = after.clips.find((c) => c.id === project.clips[0].id) as MediaClip | undefined;
    expect(source?.effects.some((e) => e.type === 'saturation')).toBe(true);
    expect(source?.keyframes.some((k) => k.property === 'scale')).toBe(true);
    expect(source?.audio.filter).toBe('voice');
    expect(source?.audio.compression).toBeGreaterThan(0);

    // Nothing overlaps on any single track.
    for (const track of after.tracks) {
      const onTrack = after.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
      for (let i = 1; i < onTrack.length; i += 1) {
        expect(onTrack[i].start).toBeGreaterThanOrEqual(clipEnd(onTrack[i - 1]) - 0.0005);
      }
    }

    // And the whole thing is one undo: the engine bumped the revision once.
    expect(after.revision).toBe(project.revision + 1);
  });

  it('lets a follow-up request keep working on the result', () => {
    const project = bakingProject();
    const ctx = testContext();
    const first = applyActions(
      project,
      [{ type: 'remove_ranges', params: { ranges: [{ start: 30, end: 400 }] } }],
      ctx,
    ).state;

    // "legg på musikk og demp den under praten"
    const withMusic = applyActions(
      first,
      [
        { type: 'create_track', params: { kind: 'audio', name: 'Music' } },
        { type: 'add_sound_effect', params: { sound: 'riser', start: 0, volume: 0.5 } },
      ],
      ctx,
    ).state;

    const music = withMusic.clips.find((c) => c.name.includes('riser')) as MediaClip;
    const speechTrack = withMusic.tracks.find((t) => t.id === TRACK_IDS[0])!;
    const ducked = applyActions(
      withMusic,
      [
        {
          type: 'auto_duck',
          params: { musicClipIds: [music.id], speechTrackIds: [speechTrack.id], amount: 0.75 },
        },
      ],
      ctx,
    ).state;

    const duckedMusic = ducked.clips.find((c) => c.id === music.id) as MediaClip;
    expect(duckedMusic.audio.duckUnderTrackIds).toContain(speechTrack.id);
    expect(duckedMusic.audio.duckAmount).toBeCloseTo(0.75, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* Scale                                                                      */
/* -------------------------------------------------------------------------- */

describe('scale', () => {
  it('handles a thousand clips across ten tracks', () => {
    const ctx = testContext();
    let state = emptyState('project-big', 'timeline-big', 'Big', TRACK_IDS);
    state = { ...state, assets: [videoAsset('a5501111-1111-4111-8111-111111111111', 4)] };

    const trackIds: string[] = [TRACK_IDS[0]];
    for (let i = 0; i < 9; i += 1) {
      const created = applyActions(state, [{ type: 'create_track', params: { kind: 'video' } }], ctx);
      state = created.state;
      trackIds.push((created.applied[0].action.params as { trackId: string }).trackId);
    }

    const started = Date.now();
    const actions = Array.from({ length: 1000 }, (_, i) => ({
      type: 'create_clip',
      params: {
        trackId: trackIds[i % trackIds.length],
        assetId: 'a5501111-1111-4111-8111-111111111111',
        start: Math.floor(i / trackIds.length) * 4,
        duration: 3.5,
      },
    }));
    const result = applyActions(state, actions, ctx);
    const elapsed = Date.now() - started;

    expect(result.state.clips).toHaveLength(1000);
    expect(elapsed).toBeLessThan(20000);

    // A later edit still only touches what it should: untouched clips keep
    // their identity, which is what makes undo snapshots cheap.
    const before = result.state;
    const trimmed = applyActions(
      before,
      [{ type: 'trim_clip', params: { clipId: before.clips[0].id, end: before.clips[0].start + 1 } }],
      ctx,
    ).state;
    const untouched = before.clips.filter((c) => c.id !== before.clips[0].id);
    const same = untouched.every((clip) => trimmed.clips.find((c) => c.id === clip.id) === clip);
    expect(same).toBe(true);
  });

  it('cuts two hundred silences out of an hour-long timeline', () => {
    const ctx = testContext();
    const hour = 3600;
    let state = emptyState('project-hour', 'timeline-hour', 'Hour', TRACK_IDS);
    state = { ...state, assets: [videoAsset('a5501111-1111-4111-8111-111111111111', hour)] };
    state = applyActions(state, [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } }], ctx).state;

    const ranges = Array.from({ length: 200 }, (_, i) => ({ start: i * 18 + 6, end: i * 18 + 12 }));
    const started = Date.now();
    const cut = applyActions(state, [{ type: 'remove_ranges', params: { ranges, ripple: true } }], ctx).state;
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(20000);
    // 200 gaps of six seconds each, removed.
    expect(timelineDuration(cut)).toBeCloseTo(hour - 200 * 6, 0);
    expect(cut.clips.length).toBeGreaterThan(150);
  });
});
