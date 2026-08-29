import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/lib/editor/store';
import { timelineDuration } from '@/lib/editor/selectors';
import { stateWithVideo, TRACK_IDS } from './helpers';

function seed() {
  useEditorStore.getState().load(stateWithVideo(60));
  useEditorStore.getState().dispatch(
    [{ type: 'create_clip', params: { trackId: TRACK_IDS[0], assetId: 'asset-1' } }],
    { label: 'Add clip' },
  );
  return useEditorStore.getState().state.clips[0].id;
}

describe('editor store', () => {
  beforeEach(() => {
    useEditorStore.getState().load(stateWithVideo(60));
  });

  it('marks the project dirty when anything changes', () => {
    expect(useEditorStore.getState().saveStatus).toBe('idle');
    seed();
    expect(useEditorStore.getState().saveStatus).toBe('dirty');
  });

  it('treats an AI batch as one undo step', () => {
    const clipId = seed();
    const before = useEditorStore.getState().state;

    const result = useEditorStore.getState().dispatch(
      [
        { type: 'remove_ranges', params: { ranges: [{ start: 5, end: 8 }], ripple: true } },
        { type: 'add_effect', params: { clipId, type: 'saturation', params: { amount: 1.3 } } },
        { type: 'set_aspect_ratio', params: { aspectRatio: '9:16' } },
        { type: 'animate_property', params: { clipId, property: 'scale', from: 1, to: 1.1 } },
      ],
      { label: 'Make it energetic', source: 'ai' },
    );

    expect(result.ok).toBe(true);
    expect(result.applied).toHaveLength(4);
    expect(useEditorStore.getState().history.past).toHaveLength(2); // seed + AI batch
    expect(useEditorStore.getState().state.settings.aspectRatio).toBe('9:16');

    const entry = useEditorStore.getState().undo();
    expect(entry?.source).toBe('ai');
    const after = useEditorStore.getState().state;
    expect(after.settings.aspectRatio).toBe('16:9');
    expect(after.clips[0].effects).toHaveLength(0);
    expect(timelineDuration(after)).toBeCloseTo(timelineDuration(before), 3);
  });

  it('rolls the whole batch back when one command is invalid', () => {
    const clipId = seed();
    const before = useEditorStore.getState().state;
    const result = useEditorStore.getState().dispatch(
      [
        { type: 'set_clip_opacity', params: { clipId, opacity: 0.5 } },
        { type: 'split_clip', params: { clipId: 'does-not-exist', time: 3 } },
      ],
      { label: 'Bad batch' },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('clip_not_found');
    // Nothing was committed, so the first command did not land either.
    expect(useEditorStore.getState().state).toBe(before);
    expect(useEditorStore.getState().state.clips[0].opacity).toBe(1);
  });

  it('applies what it can in lenient mode and reports the rest', () => {
    const clipId = seed();
    const result = useEditorStore.getState().dispatch(
      [
        { type: 'set_clip_opacity', params: { clipId, opacity: 0.5 } },
        { type: 'split_clip', params: { clipId: 'does-not-exist', time: 3 } },
        { type: 'set_clip_volume', params: { clipId, volume: 1.2 } },
      ],
      { label: 'AI batch', source: 'ai', lenient: true },
    );

    expect(result.ok).toBe(true);
    expect(result.applied).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures?.[0].error.code).toBe('clip_not_found');
    expect(useEditorStore.getState().state.clips[0].opacity).toBe(0.5);
  });

  it('redoes what it undid', () => {
    const clipId = seed();
    useEditorStore.getState().dispatch(
      [{ type: 'set_clip_opacity', params: { clipId, opacity: 0.25 } }],
      { label: 'Fade' },
    );
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().state.clips[0].opacity).toBe(1);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().state.clips[0].opacity).toBe(0.25);
  });

  it('drops the selection when the selected clip is deleted', () => {
    const clipId = seed();
    useEditorStore.getState().select([clipId]);
    expect(useEditorStore.getState().selection.clipIds).toEqual([clipId]);
    useEditorStore.getState().dispatch([{ type: 'delete_clip', params: { clipId } }], { label: 'Delete' });
    expect(useEditorStore.getState().selection.clipIds).toEqual([]);
  });

  it('keeps uploaded media out of the undo history', () => {
    seed();
    const historyBefore = useEditorStore.getState().history.past.length;
    useEditorStore.getState().registerAsset({
      id: 'asset-2',
      projectId: 'project-1',
      kind: 'audio',
      name: 'music.mp3',
      storagePath: 'user/u/projects/p/media/asset-2.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 100,
      duration: 30,
      width: null,
      height: null,
      fps: null,
      hasAudio: true,
      sampleRate: 44100,
      channels: 2,
      waveform: null,
      thumbnailUrl: null,
      analysisStatus: 'basic',
      createdAt: new Date().toISOString(),
    });
    expect(useEditorStore.getState().state.assets).toHaveLength(2);
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore);
  });

  it('clamps the playhead to the timeline', () => {
    seed();
    useEditorStore.getState().setPlayhead(-5);
    expect(useEditorStore.getState().playhead).toBe(0);
    useEditorStore.getState().setPlayhead(9999);
    expect(useEditorStore.getState().playhead).toBeCloseTo(60);
  });
});
