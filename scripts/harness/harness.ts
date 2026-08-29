/**
 * Compositor harness.
 *
 * Draws a synthetic project through the real `composeFrame` so the rendering
 * path can be inspected in a browser without a Supabase project or any media.
 * Build it with `node scripts/build-harness.mjs`, then open
 * scripts/harness/index.html.
 */
import type { EditorState, MediaClip, TextClip } from '../../types/editor';
import { baseClipFields, captionTextStyle, defaultSettings, defaultTextStyle, defaultTrack } from '../../lib/editor/defaults';
import { composeFrame, type Drawable, type FrameProvider } from '../../lib/render/compose';
import { applyActions } from '../../lib/editor/engine';

const WIDTH = 1280;
const HEIGHT = 720;

/** Stand-in "decoded frame": a labelled colour field, so transforms are visible. */
function makeFakeFrame(label: string, colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
  gradient.addColorStop(0, colour);
  gradient.addColorStop(1, '#101014');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  for (let x = 0; x <= 1920; x += 160) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1080);
    ctx.stroke();
  }
  for (let y = 0; y <= 1080; y += 160) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1920, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 120px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 960, 540);
  return canvas;
}

const FRAMES: Record<string, HTMLCanvasElement> = {};

const provider: FrameProvider = {
  getFrame: (clip) => (FRAMES[clip.assetId] as Drawable) ?? null,
  getSize: () => ({ width: 1920, height: 1080 }),
};

function buildState(): EditorState {
  const trackIds = ['t-video', 't-overlay', 't-text'];
  const base: EditorState = {
    projectId: 'demo',
    timelineId: 'demo',
    name: 'Compositor harness',
    settings: { ...defaultSettings(), width: WIDTH, height: HEIGHT },
    tracks: [
      defaultTrack(trackIds[0], 'video', 0, 'Video'),
      defaultTrack(trackIds[1], 'overlay', 1, 'Overlay'),
      defaultTrack(trackIds[2], 'text', 2, 'Text'),
    ],
    clips: [],
    assets: [
      {
        id: 'a1', projectId: 'demo', kind: 'video', name: 'A', storagePath: '', mimeType: 'video/mp4',
        sizeBytes: 0, duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, sampleRate: 48000,
        channels: 2, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '',
      },
      {
        id: 'a2', projectId: 'demo', kind: 'video', name: 'B', storagePath: '', mimeType: 'video/mp4',
        sizeBytes: 0, duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, sampleRate: 48000,
        channels: 2, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '',
      },
    ],
    analysis: {},
    revision: 0,
  };

  const shotA: MediaClip = {
    ...baseClipFields('c1', trackIds[0], 0, 6, 'Shot A'),
    kind: 'video', assetId: 'a1', sourceIn: 0, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0, crop: null, freeze: false,
  };
  const shotB: MediaClip = {
    ...baseClipFields('c2', trackIds[0], 6, 6, 'Shot B'),
    kind: 'video', assetId: 'a2', sourceIn: 0, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0, crop: null, freeze: false,
  };
  const title: TextClip = {
    ...baseClipFields('c3', trackIds[2], 0.5, 4, 'Title'),
    kind: 'text', text: 'VideoAI', style: { ...defaultTextStyle(), fontSize: 0.12 }, animation: 'pop',
  };
  const caption: TextClip = {
    ...baseClipFields('c4', trackIds[2], 7, 4, 'Caption'),
    kind: 'text',
    text: 'A caption line that has to wrap because it is long',
    style: { ...captionTextStyle(), strokeWidth: 0.004 },
    animation: 'none',
    role: 'caption',
    groupId: 'g1',
    transform: { x: 0, y: 0.33, scale: 1, rotation: 0, flipH: false, flipV: false },
  };

  const withClips: EditorState = { ...base, clips: [shotA, shotB, title, caption] };

  return applyActions(withClips, [
    { type: 'add_transition_between', params: { fromClipId: 'c1', toClipId: 'c2', type: 'crossfade', duration: 1.2 } },
    { type: 'add_effect', params: { clipId: 'c2', type: 'saturation', params: { amount: 1.4 } } },
    { type: 'add_effect', params: { clipId: 'c2', type: 'vignette', params: { amount: 0.55, softness: 0.5 } } },
    { type: 'animate_property', params: { clipId: 'c1', property: 'scale', from: 1, to: 1.25, startTime: 0, endTime: 6 } },
    { type: 'set_transform', params: { clipId: 'c2', x: 0.08, rotation: -3 } },
  ]).state;
}

function render(): void {
  FRAMES.a1 = makeFakeFrame('A', '#2b4bd8');
  FRAMES.a2 = makeFakeFrame('B', '#c2413c');

  const state = buildState();
  const times = [0.7, 2.5, 5.4, 6.0, 6.6, 8.5];
  const root = document.getElementById('frames')!;

  for (const time of times) {
    const wrapper = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    composeFrame(ctx, state, time, provider);
    const caption = document.createElement('figcaption');
    caption.textContent = `t = ${time.toFixed(1)}s`;
    wrapper.append(canvas, caption);
    root.append(wrapper);
  }
  document.body.dataset.rendered = 'true';
}

render();
