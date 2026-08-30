/**
 * Music beds are looped clips, and looping is exactly the kind of arithmetic
 * that goes wrong quietly: a gap between loops, a fade in the middle of the
 * track, one clip too many past the end.
 */
import { describe, expect, it } from 'vitest';
import type { MediaClip } from '@/types/editor';
import { emptyState } from '@/lib/editor/defaults';
import { applyActions } from '@/lib/editor/engine';
import { clipEnd } from '@/lib/editor/time';
import { MUSIC_LOOP_SECONDS } from '@/lib/editor/actions/music';
import { testContext, TRACK_IDS, videoAsset } from './helpers';

const VIDEO = 'a5501111-1111-4111-8111-111111111111';

function project() {
  const base = emptyState(
    'p9001111-1111-4111-8111-111111111111',
    'p9001111-1111-4111-8111-111111111112',
    'Music',
    TRACK_IDS,
  );
  return { ...base, assets: [videoAsset(VIDEO, 120)] };
}

describe('add_music', () => {
  it('loops to cover the requested length without gaps or overlaps', () => {
    const ctx = testContext();
    const state = applyActions(
      project(),
      [{ type: 'add_music', params: { bed: 'lofi_chill', start: 0, duration: 50 } }],
      ctx,
    ).state;

    const clips = state.clips.filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);
    expect(clips.length).toBe(Math.ceil(50 / MUSIC_LOOP_SECONDS));
    expect(clips[0].start).toBe(0);
    expect(clipEnd(clips[clips.length - 1])).toBeCloseTo(50, 2);

    for (let i = 1; i < clips.length; i += 1) {
      expect(clips[i].start).toBeCloseTo(clipEnd(clips[i - 1]), 3);
    }
  });

  it('fades in once at the start and out once at the end', () => {
    const ctx = testContext();
    const state = applyActions(
      project(),
      [{ type: 'add_music', params: { bed: 'upbeat_pop', start: 0, duration: 40, fadeIn: 1, fadeOut: 2 } }],
      ctx,
    ).state;

    const clips = state.clips
      .filter((c): c is MediaClip => c.kind === 'audio')
      .sort((a, b) => a.start - b.start);

    expect(clips[0].fadeIn).toBeCloseTo(1, 3);
    expect(clips[clips.length - 1].fadeOut).toBeCloseTo(2, 3);
    for (const clip of clips.slice(1)) expect(clip.fadeIn).toBe(0);
    for (const clip of clips.slice(0, -1)) expect(clip.fadeOut).toBe(0);
  });

  it('reuses one asset no matter how many loops it takes', () => {
    const ctx = testContext();
    const state = applyActions(
      project(),
      [{ type: 'add_music', params: { bed: 'calm_piano', start: 0, duration: 90 } }],
      ctx,
    ).state;

    const musicAssets = state.assets.filter((a) => a.storagePath.startsWith('music:'));
    expect(musicAssets).toHaveLength(1);
    // Nothing is stored for it: the path is the recipe.
    expect(musicAssets[0].sizeBytes).toBe(0);
    expect(musicAssets[0].storagePath).toBe('music:calm_piano');
  });

  it('covers the rest of the timeline when no length is given', () => {
    const ctx = testContext();
    const withClip = applyActions(
      project(),
      [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: VIDEO, start: 0, duration: 35 } }],
      ctx,
    ).state;

    const state = applyActions(withClip, [{ type: 'add_music', params: { bed: 'energy_run' } }], ctx).state;
    const music = state.clips.filter((c) => c.name.includes('energy'));
    const end = music.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
    expect(end).toBeGreaterThanOrEqual(35);
  });
});
