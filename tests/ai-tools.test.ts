import { describe, expect, it } from 'vitest';
import { buildTools } from '@/lib/ai/run';
import { ACTION_TYPES, aiExposedActions, applyAction } from '@/lib/editor/engine';
import { READ_TOOLS } from '@/lib/ai/read-tools';
import { EditorError } from '@/lib/editor/errors';
import { buildProjectContext, assetRangeToTimeline, findInTranscript, timelineSilences } from '@/lib/ai/project-context';
import { stateWithVideo, testContext, TRACK_IDS } from './helpers';
import type { MediaAnalysis } from '@/types/editor';

function withClipAndAnalysis() {
  const ctx = testContext();
  const base = stateWithVideo(60);
  const { state } = applyAction(base, { type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'a5501111-1111-4111-8111-111111111111' } }, ctx);
  const analysis: MediaAnalysis = {
    assetId: 'a5501111-1111-4111-8111-111111111111',
    language: 'en',
    text: 'hello there ehm this is a test',
    words: [
      { word: 'hello', start: 1, end: 1.4 },
      { word: 'there', start: 1.4, end: 1.9 },
      { word: 'ehm', start: 5, end: 5.4 },
      { word: 'this', start: 6, end: 6.3 },
      { word: 'is', start: 6.3, end: 6.5 },
      { word: 'a', start: 6.5, end: 6.6 },
      { word: 'test', start: 6.6, end: 7 },
    ],
    segments: [
      { id: 0, start: 1, end: 1.9, text: 'hello there' },
      { id: 1, start: 5, end: 7, text: 'ehm this is a test' },
    ],
    silences: [
      { start: 2, end: 4.5 },
      { start: 10, end: 10.3 },
    ],
    loudnessDb: -18,
    createdAt: new Date(0).toISOString(),
  };
  return { state: { ...state, analysis: { 'a5501111-1111-4111-8111-111111111111': analysis } }, ctx };
}

describe('AI tool surface', () => {
  it('exposes every editor command plus the read tools', () => {
    const tools = buildTools();
    const names = tools.map((t) => t.function.name);
    expect(names).toHaveLength(READ_TOOLS.length + aiExposedActions().length);
    for (const action of aiExposedActions()) expect(names).toContain(action.type);
    for (const readTool of READ_TOOLS) expect(names).toContain(readTool.name);
  });

  it('hides internal plumbing from the model', () => {
    const names = buildTools().map((t) => t.function.name);
    expect(ACTION_TYPES).toContain('register_asset');
    expect(names).not.toContain('register_asset');
    expect(names).not.toContain('set_media_analysis');
  });

  it('produces a valid JSON schema for every tool', () => {
    for (const tool of buildTools()) {
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters).toHaveProperty('properties');
      expect(typeof tool.function.description).toBe('string');
      expect((tool.function.description as string).length).toBeGreaterThan(10);
    }
  });
});

describe('AI validation', () => {
  it('rejects a made-up clip id with a recoverable error', () => {
    const { state } = withClipAndAnalysis();
    try {
      // A model that hallucinates usually hallucinates a well-formed uuid.
      applyAction(state, {
        type: 'split_clip',
        params: { clipId: 'deadbeef-0000-4000-8000-000000000000', time: 3 },
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EditorError);
      const editorError = error as EditorError;
      expect(editorError.code).toBe('clip_not_found');
      // The error tells the model what ids do exist, so it can retry.
      expect(editorError.details.availableClipIds).toBeInstanceOf(Array);
    }
  });

  it('rejects out-of-range parameters before anything is applied', () => {
    const { state } = withClipAndAnalysis();
    const clipId = state.clips[0].id;
    expect(() => applyAction(state, { type: 'set_clip_opacity', params: { clipId, opacity: 12 } })).toThrowError(
      /Invalid parameters/,
    );
    expect(() => applyAction(state, { type: 'set_clip_speed', params: { clipId, speed: -3 } })).toThrowError(
      /Invalid parameters/,
    );
  });

  it('refuses an unknown effect parameter', () => {
    const { state } = withClipAndAnalysis();
    const clipId = state.clips[0].id;
    expect(() =>
      applyAction(state, { type: 'add_effect', params: { clipId, type: 'blur', params: { wobble: 3 } } }),
    ).toThrowError(/not a parameter/);
  });
});

describe('timeline mapping', () => {
  it('maps asset time to timeline time', () => {
    const { state } = withClipAndAnalysis();
    const ranges = assetRangeToTimeline(state, 'a5501111-1111-4111-8111-111111111111', 5, 7);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(5);
    expect(ranges[0].end).toBeCloseTo(7);
  });

  it('accounts for trimming and speed', () => {
    const { state, ctx } = withClipAndAnalysis();
    const clipId = state.clips[0].id;
    const trimmed = applyAction(state, { type: 'trim_clip', params: { clipId, start: 4 } }, ctx).state;
    const sped = applyAction(trimmed, { type: 'set_clip_speed', params: { clipId, speed: 2 } }, ctx).state;
    // Source second 8 is 4 seconds of source past the in-point (4), so at 2x
    // speed it lands 2 seconds after the clip's timeline start.
    const ranges = assetRangeToTimeline(sped, 'a5501111-1111-4111-8111-111111111111', 8, 10);
    expect(ranges[0].start).toBeCloseTo(4 + 2, 3);
    expect(ranges[0].end).toBeCloseTo(4 + 3, 3);
  });

  it('finds silences long enough to matter', () => {
    const { state } = withClipAndAnalysis();
    const long = timelineSilences(state, 0.5);
    expect(long).toHaveLength(1);
    expect(long[0].start).toBeCloseTo(2);
    const all = timelineSilences(state, 0.1);
    expect(all).toHaveLength(2);
  });

  it('finds a spoken word and returns timeline seconds', () => {
    const { state } = withClipAndAnalysis();
    const hits = findInTranscript(state, 'ehm');
    expect(hits).toHaveLength(1);
    expect(hits[0].start).toBeLessThan(5.01);
    expect(hits[0].end).toBeGreaterThan(5.39);
  });

  it('finds a multi-word phrase', () => {
    const { state } = withClipAndAnalysis();
    const hits = findInTranscript(state, 'this is a test');
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('this is a test');
  });
});

describe('project context', () => {
  it('gives the model real ids and no prose', () => {
    const { state } = withClipAndAnalysis();
    const context = buildProjectContext(state, [state.clips[0].id], 3.5);
    expect(context.project.duration).toBeGreaterThan(0);
    expect(context.clips[0].id).toBe(state.clips[0].id);
    expect(context.tracks).toHaveLength(3);
    expect(context.assets[0].transcript).toBe('available');
    expect(context.selection).toEqual([state.clips[0].id]);
    expect(context.playhead).toBe(3.5);
  });

  it('collapses long caption runs so they cannot crowd out the project', () => {
    const { state, ctx } = withClipAndAnalysis();
    const lines = Array.from({ length: 150 }, (_, i) => ({
      start: i * 0.4,
      end: i * 0.4 + 0.35,
      text: `line ${i}`,
    }));
    const withCaptions = applyAction(
      state,
      { type: 'add_captions', params: { trackId: TRACK_IDS[2], lines } },
      ctx,
    ).state;

    const context = buildProjectContext(withCaptions);
    expect(withCaptions.clips.length).toBe(151);
    expect(context.clips.length).toBeLessThan(20);
    expect(context.captionGroups?.[0].lines).toBe(150);
  });
});
