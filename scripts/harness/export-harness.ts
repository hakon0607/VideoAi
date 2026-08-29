/**
 * Export harness.
 *
 * Runs the real exportProject() against two local test clips so the whole
 * pipeline — demux, decode, composite, encode, mux — can be verified without a
 * Supabase project. Used by the repository's verification script.
 */
import type { EditorState, MediaClip, TextClip } from '../../types/editor';
import { baseClipFields, captionTextStyle, defaultSettings, defaultTrack } from '../../lib/editor/defaults';
import { applyActions } from '../../lib/editor/engine';
import { exportProject, checkExportSupport } from '../../lib/render/export';

declare global {
  interface Window {
    runExport: () => Promise<{ size: number; type: string; base64: string }>;
    exportLog: string[];
  }
}

window.exportLog = [];

function buildState(): EditorState {
  const tracks: [string, string, string] = ['t-video', 't-audio', 't-text'];
  const base: EditorState = {
    projectId: 'demo',
    timelineId: 'demo',
    name: 'Export test',
    settings: { ...defaultSettings(), width: 1280, height: 720, fps: 30 },
    tracks: [
      defaultTrack(tracks[0], 'video', 0, 'Video'),
      defaultTrack(tracks[1], 'audio', 1, 'Audio'),
      defaultTrack(tracks[2], 'text', 2, 'Text'),
    ],
    clips: [],
    assets: [
      { id: 'a1', projectId: 'demo', kind: 'video', name: 'clip-a.webm', storagePath: '', mimeType: 'video/webm', sizeBytes: 0, duration: 6, width: 1280, height: 720, fps: 30, hasAudio: true, sampleRate: 44100, channels: 1, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '' },
      { id: 'a2', projectId: 'demo', kind: 'video', name: 'clip-b.webm', storagePath: '', mimeType: 'video/webm', sizeBytes: 0, duration: 6, width: 1280, height: 720, fps: 30, hasAudio: true, sampleRate: 44100, channels: 1, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '' },
    ],
    analysis: {},
    revision: 0,
  };

  const a: MediaClip = {
    ...baseClipFields('c1', tracks[0], 0, 3, 'clip-a'),
    kind: 'video', assetId: 'a1', sourceIn: 0.5, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0.4, crop: null, freeze: false,
  };
  const b: MediaClip = {
    ...baseClipFields('c2', tracks[0], 3, 3, 'clip-b'),
    kind: 'video', assetId: 'a2', sourceIn: 1, speed: 1.5, reversed: false, volume: 0.6,
    muted: false, fadeIn: 0.4, fadeOut: 0, crop: null, freeze: false,
  };
  const caption: TextClip = {
    ...baseClipFields('c3', tracks[2], 0.5, 4, 'Caption'),
    kind: 'text', text: 'Exported by VideoAI', style: captionTextStyle(), animation: 'fade',
    role: 'caption', groupId: 'g1',
    transform: { x: 0, y: 0.33, scale: 1, rotation: 0, flipH: false, flipV: false },
  };

  return applyActions({ ...base, clips: [a, b, caption] }, [
    { type: 'add_transition_between', params: { fromClipId: 'c1', toClipId: 'c2', type: 'crossfade', duration: 0.8 } },
    { type: 'add_effect', params: { clipId: 'c1', type: 'saturation', params: { amount: 1.4 } } },
    { type: 'add_effect', params: { clipId: 'c2', type: 'vignette', params: { amount: 0.4, softness: 0.6 } } },
    { type: 'animate_property', params: { clipId: 'c1', property: 'scale', from: 1, to: 1.2, startTime: 0, endTime: 3 } },
  ]).state;
}

window.runExport = async () => {
  const support = await checkExportSupport();
  window.exportLog.push(`support: ${JSON.stringify(support)}`);

  const state = buildState();
  const urls = {
    a1: new URL('../../.verify/media/clip-a.webm', import.meta.url).toString(),
    a2: new URL('../../.verify/media/clip-b.webm', import.meta.url).toString(),
  };

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
