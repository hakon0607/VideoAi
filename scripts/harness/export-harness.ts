/**
 * Export harness.
 *
 * Runs the real exportProject() against two local test clips so the whole
 * pipeline — demux, decode, composite, encode, mux — can be verified without a
 * Supabase project. Used by the repository's verification script.
 */
import type { EditorState, MediaClip, TextClip } from '../../types/editor';
import { defaultAudioProcessing, baseClipFields, captionTextStyle, defaultSettings, defaultTrack } from '../../lib/editor/defaults';
import { applyActions } from '../../lib/editor/engine';
import { exportProject, checkExportSupport } from '../../lib/render/export';
import { renderSfxFile } from '../../lib/media/sfx';

declare global {
  interface Window {
    runExport: () => Promise<{ size: number; type: string; base64: string }>;
    exportLog: string[];
  }
}

window.exportLog = [];

function buildState(): EditorState {
  const tracks: [string, string, string] = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003'];
  const base: EditorState = {
    projectId: 'd0000000-0000-4000-8000-000000000001',
    timelineId: 'd0000000-0000-4000-8000-000000000001',
    name: 'Export test',
    settings: { ...defaultSettings(), width: 1280, height: 720, fps: 30 },
    tracks: [
      defaultTrack(tracks[0], 'video', 0, 'Video'),
      defaultTrack(tracks[1], 'audio', 1, 'Audio'),
      defaultTrack(tracks[2], 'text', 2, 'Text'),
    ],
    clips: [],
    assets: [
      { id: 'a0000000-0000-4000-8000-000000000001', projectId: 'd0000000-0000-4000-8000-000000000001', folderId: null, kind: 'video', name: 'clip-a.webm', storagePath: '', mimeType: 'video/webm', sizeBytes: 0, duration: 6, width: 1280, height: 720, fps: 30, hasAudio: true, sampleRate: 44100, channels: 1, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '' },
      { id: 'a0000000-0000-4000-8000-000000000002', projectId: 'd0000000-0000-4000-8000-000000000001', folderId: null, kind: 'video', name: 'clip-b.webm', storagePath: '', mimeType: 'video/webm', sizeBytes: 0, duration: 6, width: 1280, height: 720, fps: 30, hasAudio: true, sampleRate: 44100, channels: 1, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '' },
    ],
    analysis: {},
    markers: [],
    folders: [],
    revision: 0,
  };

  const a: MediaClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000001', tracks[0], 0, 3, 'clip-a'),
    kind: 'video', assetId: 'a0000000-0000-4000-8000-000000000001', sourceIn: 0.5, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0.4, crop: null, freeze: false, audio: defaultAudioProcessing(),
  };
  const b: MediaClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000002', tracks[0], 3, 3, 'clip-b'),
    kind: 'video', assetId: 'a0000000-0000-4000-8000-000000000002', sourceIn: 1, speed: 1.5, reversed: false, volume: 0.6,
    muted: false, fadeIn: 0.4, fadeOut: 0, crop: null, freeze: false, audio: defaultAudioProcessing(),
  };
  const caption: TextClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000003', tracks[2], 0.5, 4, 'Caption'),
    kind: 'text', text: 'Exported by VideoAI', style: captionTextStyle(), animation: 'fade',
    role: 'caption', groupId: '90000000-0000-4000-8000-000000000001',
    transform: { x: 0, y: 0.33, scale: 1, rotation: 0, flipH: false, flipV: false },
  };

  const C1 = 'c0000000-0000-4000-8000-000000000001';
  const C2 = 'c0000000-0000-4000-8000-000000000002';

  // Everything the compositor and the mixer can do, in one file: an overlap
  // transition, post effects, keyframes, a karaoke caption, an emoji sticker,
  // two synthesised sounds, a voice chain and ducking under the speech track.
  return applyActions({ ...base, clips: [a, b, caption] }, [
    { type: 'add_transition_between', params: { fromClipId: C1, toClipId: C2, type: 'crossfade', duration: 0.8 } },
    { type: 'add_effect', params: { clipId: C1, type: 'saturation', params: { amount: 1.4 } } },
    { type: 'add_effect', params: { clipId: C1, type: 'film_grain', params: { amount: 0.35 } } },
    { type: 'add_effect', params: { clipId: C2, type: 'vignette', params: { amount: 0.4, softness: 0.6 } } },
    { type: 'add_effect', params: { clipId: C2, type: 'glow', params: { amount: 0.3 } } },
    { type: 'animate_property', params: { clipId: C1, property: 'scale', from: 1, to: 1.2, startTime: 0, endTime: 3 } },
    { type: 'add_zoom_punch', params: { clipId: C2, at: 3.6, scale: 1.25 } },
    { type: 'add_captions', params: {
        trackId: '70000000-0000-4000-8000-000000000003',
        animation: 'karaoke',
        lines: [{ start: 4.6, end: 5.8, text: 'karaoke line here' }],
      } },
    { type: 'add_sticker', params: { emoji: '🔥', start: 1.2, duration: 1.4, size: 0.18, x: 0.3, y: -0.3 } },
    { type: 'add_sound_effect', params: { sound: 'whoosh', start: 2.6 } },
    { type: 'add_sound_effect', params: { sound: 'ding', start: 4.4 } },
    { type: 'enhance_voice', params: { clipIds: [C1], strength: 0.7 } },
    { type: 'set_clip_reverse', params: { clipId: C2, reversed: false } },
  ]).state;
}

window.runExport = async () => {
  const support = await checkExportSupport();
  window.exportLog.push(`support: ${JSON.stringify(support)}`);

  const state = buildState();
  const urls: Record<string, string> = {
    'a0000000-0000-4000-8000-000000000001': new URL('../../.verify/media/clip-a.webm', import.meta.url).toString(),
    'a0000000-0000-4000-8000-000000000002': new URL('../../.verify/media/clip-b.webm', import.meta.url).toString(),
  };

  // The sound effects are placeholders until something renders them; in the app
  // that is the editor root, here it is this loop.
  for (const asset of state.assets) {
    if (!asset.storagePath.startsWith('sfx:')) continue;
    const file = await renderSfxFile(asset.storagePath.slice(4));
    urls[asset.id] = URL.createObjectURL(file);
    window.exportLog.push(`rendered ${asset.name}: ${file.size} bytes`);
  }

  const result = await exportProject(
    state,
    urls,
    { width: 1280, height: 720, fps: 30, format: 'mp4', quality: 'medium', includeAudio: true, rangeStart: null, rangeEnd: null },
    (progress) => {
      if (progress.frame === undefined || progress.frame % 30 === 0) {
        window.exportLog.push(`${progress.stage} ${Math.round(progress.fraction * 100)}%`);
      }
    },
  );

  const buffer = await result.blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return { size: result.blob.size, type: result.blob.type, base64: btoa(binary) };
};
