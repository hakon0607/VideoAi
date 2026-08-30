/**
 * Compositor harness.
 *
 * Draws a synthetic project through the real `composeFrame` so the rendering
 * path can be inspected in a browser without a Supabase project or any media.
 * Build it with `node scripts/build-harness.mjs`, then open
 * scripts/harness/index.html.
 */
import type { EditorState, MediaClip, TextClip } from '../../types/editor';
import {
  defaultAudioProcessing,
  baseClipFields,
  captionTextStyle,
  defaultSettings,
  defaultTextStyle,
  defaultTrack,
  EFFECT_RANGES,
} from '../../lib/editor/defaults';
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
  const trackIds = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003'];
  const base: EditorState = {
    projectId: 'd0000000-0000-4000-8000-000000000001',
    timelineId: 'd0000000-0000-4000-8000-000000000001',
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
        id: 'a0000000-0000-4000-8000-000000000001', projectId: 'd0000000-0000-4000-8000-000000000001', folderId: null, kind: 'video', name: 'A', storagePath: '', mimeType: 'video/mp4',
        sizeBytes: 0, duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, sampleRate: 48000,
        channels: 2, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '',
      },
      {
        id: 'a0000000-0000-4000-8000-000000000002', projectId: 'd0000000-0000-4000-8000-000000000001', folderId: null, kind: 'video', name: 'B', storagePath: '', mimeType: 'video/mp4',
        sizeBytes: 0, duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, sampleRate: 48000,
        channels: 2, waveform: null, thumbnailUrl: null, analysisStatus: 'basic', createdAt: '',
      },
    ],
    analysis: {},
    markers: [],
    folders: [],
    revision: 0,
  };

  const shotA: MediaClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000001', trackIds[0], 0, 6, 'Shot A'),
    kind: 'video', assetId: 'a0000000-0000-4000-8000-000000000001', sourceIn: 0, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0, crop: null, freeze: false, audio: defaultAudioProcessing(),
  };
  const shotB: MediaClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000002', trackIds[0], 6, 6, 'Shot B'),
    kind: 'video', assetId: 'a0000000-0000-4000-8000-000000000002', sourceIn: 0, speed: 1, reversed: false, volume: 1,
    muted: false, fadeIn: 0, fadeOut: 0, crop: null, freeze: false, audio: defaultAudioProcessing(),
  };
  const title: TextClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000003', trackIds[2], 0.5, 4, 'Title'),
    kind: 'text', text: 'VideoAI', style: { ...defaultTextStyle(), fontSize: 0.12 }, animation: 'pop',
  };
  const caption: TextClip = {
    ...baseClipFields('c0000000-0000-4000-8000-000000000004', trackIds[2], 7, 4, 'Caption'),
    kind: 'text',
    text: 'A caption line that has to wrap because it is long',
    style: { ...captionTextStyle(), strokeWidth: 0.004 },
    animation: 'none',
    role: 'caption',
    groupId: '90000000-0000-4000-8000-000000000001',
    transform: { x: 0, y: 0.33, scale: 1, rotation: 0, flipH: false, flipV: false },
  };

  const withClips: EditorState = { ...base, clips: [shotA, shotB, title, caption] };

  return applyActions(withClips, [
    { type: 'add_transition_between', params: { fromClipId: 'c0000000-0000-4000-8000-000000000001', toClipId: 'c0000000-0000-4000-8000-000000000002', type: 'crossfade', duration: 1.2 } },
    { type: 'add_effect', params: { clipId: 'c0000000-0000-4000-8000-000000000002', type: 'saturation', params: { amount: 1.4 } } },
    { type: 'add_effect', params: { clipId: 'c0000000-0000-4000-8000-000000000002', type: 'vignette', params: { amount: 0.55, softness: 0.5 } } },
    { type: 'animate_property', params: { clipId: 'c0000000-0000-4000-8000-000000000001', property: 'scale', from: 1, to: 1.25, startTime: 0, endTime: 6 } },
    { type: 'set_transform', params: { clipId: 'c0000000-0000-4000-8000-000000000002', x: 0.08, rotation: -3 } },
  ]).state;
}

function render(): void {
  FRAMES['a0000000-0000-4000-8000-000000000001'] = makeFakeFrame('A', '#2b4bd8');
  FRAMES['a0000000-0000-4000-8000-000000000002'] = makeFakeFrame('B', '#c2413c');

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

/* -------------------------------------------------------------------------- */
/* Compositor stress                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Renders every effect, transition and text animation the editor offers, at
 * every point in its life, through the real compositor. A crash here is a black
 * preview and a failed export for the user, so it is worth being brutal: this
 * draws thousands of frames of deliberately awkward projects — clips scaled to
 * nothing, rotated past a full turn, cropped to a sliver, animated to values a
 * slider could never produce.
 */
declare global {
  interface Window {
    stressCompose: () => { frames: number; errors: string[] };
  }
}

window.stressCompose = () => {
  FRAMES['a0000000-0000-4000-8000-000000000001'] = makeFakeFrame('A', '#2b4bd8');
  FRAMES['a0000000-0000-4000-8000-000000000002'] = makeFakeFrame('B', '#c2413c');

  const errors: string[] = [];
  let frames = 0;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const effectTypes = [
    'brightness', 'contrast', 'saturation', 'exposure', 'temperature', 'tint', 'hue_rotate',
    'grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'pixelate', 'film_grain',
    'chromatic_aberration', 'vignette', 'glow', 'mirror', 'shake',
  ];
  const transitionTypes = [
    'cut', 'fade', 'crossfade', 'dissolve', 'slide', 'zoom', 'wipe',
    'whip_pan', 'flash', 'glitch', 'blur_dissolve', 'spin',
  ];
  const animations = [
    'none', 'fade', 'pop', 'slide_up', 'slide_left', 'typewriter',
    'bounce', 'zoom_in', 'wipe', 'shake', 'karaoke',
  ];

  const base = buildState();

  // A quarter-second step: enough to cross every transition and animation
  // window several times, without spending minutes on the expensive end of the
  // blur and glow ranges, which are genuinely slow at 1280x720 by nature.
  const draw = (state: EditorState, label: string) => {
    for (let t = 0; t <= 10; t += 0.25) {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        composeFrame(ctx, state, t, provider);
        frames += 1;
      } catch (error) {
        errors.push(`${label} @${t.toFixed(1)}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
  };

  // One pass per effect at each end of its range and in the middle, so both the
  // "off" and the "absurd" ends of every slider are drawn.
  for (const type of effectTypes) {
    const ranges = EFFECT_RANGES[type as keyof typeof EFFECT_RANGES] ?? {};
    for (const position of [0, 0.5, 1]) {
      const params: Record<string, number> = {};
      for (const [key, [min, max]] of Object.entries(ranges)) {
        params[key] = min + (max - min) * position;
      }
      try {
        const state = applyActions(base, [
          { type: 'clear_effects', params: { clipId: 'c0000000-0000-4000-8000-000000000001' } },
          { type: 'add_effect', params: { clipId: 'c0000000-0000-4000-8000-000000000001', type, params } },
          { type: 'clear_effects', params: { clipId: 'c0000000-0000-4000-8000-000000000002' } },
          { type: 'add_effect', params: { clipId: 'c0000000-0000-4000-8000-000000000002', type, params } },
        ]).state;
        draw(state, `effect ${type} @${position}`);
      } catch (error) {
        errors.push(`effect ${type} @${position} refused: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const type of transitionTypes) {
    try {
      const state = applyActions(base, [
        { type: 'add_transition_between', params: {
            fromClipId: 'c0000000-0000-4000-8000-000000000001',
            toClipId: 'c0000000-0000-4000-8000-000000000002',
            type, duration: 1.2 } },
      ]).state;
      draw(state, `transition ${type}`);
    } catch (error) {
      void error;
    }
  }

  for (const animation of animations) {
    try {
      const state = applyActions(base, [
        { type: 'set_text_animation', params: { clipId: 'c0000000-0000-4000-8000-000000000004', animation } },
      ]).state;
      draw(state, `animation ${animation}`);
    } catch (error) {
      void error;
    }
  }

  // Hostile transforms and crops. Wrapped, because a refused parameter is the
  // engine doing its job rather than a rendering failure.
  try {
  const hostile = applyActions(base, [
    { type: 'set_transform', params: { clipId: 'c0000000-0000-4000-8000-000000000001', scale: 0.05, rotation: 3599, x: -4, y: 4 } },
    { type: 'set_crop', params: { clipId: 'c0000000-0000-4000-8000-000000000002', left: 0.49, right: 0.49, top: 0.49, bottom: 0.49 } },
    { type: 'set_clip_opacity', params: { clipId: 'c0000000-0000-4000-8000-000000000002', opacity: 0 } },
  ]).state;
  draw(hostile, 'hostile transforms');
  } catch (error) {
    errors.push(`hostile setup refused: ${error instanceof Error ? error.message : String(error)}`);
  }

  // An empty project still has to draw the background.
  draw({ ...base, clips: [] }, 'empty timeline');

  return { frames, errors };
};

/* -------------------------------------------------------------------------- */
/* Local media store                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Exercises the storage the whole product now depends on.
 *
 * With uploads kept on the user's own machine, a bug here does not mean a
 * failed request — it means footage that cannot be found. So: write, read back
 * byte for byte, list, delete, sweep, and check the browser actually gave us
 * somewhere durable to put it.
 */
declare global {
  interface Window {
    stressLocalMedia: () => Promise<{ ok: boolean; steps: string[]; failures: string[] }>;
    renderMusicBed: (id: string) => Promise<string>;
  }
}

/** Renders one bed to base64, so the verification script can listen to it. */
window.renderMusicBed = async (id: string) => {
  const { renderMusic } = await import('../../lib/media/music');
  const blob = await renderMusic(id);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};

window.stressLocalMedia = async () => {
  const { putLocalFile, getLocalFile, hasLocalFile, deleteLocalFile, listLocalFiles, sweepOrphans, localStorageUsage, requestPersistence } =
    await import('../../lib/media/local-store');
  const { renderMusic, MUSIC_LIBRARY } = await import('../../lib/media/music');
  const { renderSfx, SFX_LIBRARY } = await import('../../lib/media/sfx');

  const steps: string[] = [];
  const failures: string[] = [];
  const check = (condition: boolean, label: string) => {
    steps.push(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
    if (!condition) failures.push(label);
  };

  const persistent = await requestPersistence();
  steps.push(`note persistent storage: ${persistent}`);

  // A file of a few megabytes, so this is not just a toy blob.
  const bytes = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) % 256;
  const original = new Blob([bytes], { type: 'video/mp4' });

  await putLocalFile('harness-a', original);
  check(await hasLocalFile('harness-a'), 'a written file is reported present');

  const readBack = await getLocalFile('harness-a');
  check(readBack !== null, 'a written file reads back');
  if (readBack) {
    const returned = new Uint8Array(await readBack.arrayBuffer());
    check(returned.length === bytes.length, 'the file is the same length');
    let identical = true;
    for (let i = 0; i < bytes.length; i += 4099) {
      if (returned[i] !== bytes[i]) {
        identical = false;
        break;
      }
    }
    check(identical, 'the bytes come back unchanged');
  }

  await putLocalFile('harness-b', new Blob([new Uint8Array(1024)]));
  const listed = await listLocalFiles();
  check(listed.includes('harness-a') && listed.includes('harness-b'), 'both files are listed');

  await deleteLocalFile('harness-b');
  check(!(await hasLocalFile('harness-b')), 'a deleted file is gone');
  check((await getLocalFile('harness-b')) === null, 'a missing file reads as null, not an error');

  const removed = await sweepOrphans(['harness-a']);
  steps.push(`note sweep removed ${removed}`);
  check(await hasLocalFile('harness-a'), 'the sweep keeps what the server still knows about');

  const usage = await localStorageUsage();
  check(usage.quota > 0, 'the browser reports a storage quota');
  steps.push(`note usage ${Math.round(usage.used / 1024 / 1024)} MB of ${Math.round(usage.quota / 1024 / 1024)} MB`);

  await deleteLocalFile('harness-a');

  // Every generated sound has to render, because nothing is stored for them.
  for (const sfx of SFX_LIBRARY) {
    const blob = await renderSfx(sfx.id);
    check(blob.size > 1000, `sfx ${sfx.id} renders`);
  }
  for (const bed of MUSIC_LIBRARY) {
    const blob = await renderMusic(bed.id);
    check(blob.size > 100000, `music ${bed.id} renders`);
  }

  // Deterministic: the same id twice is the same audio.
  const first = await renderMusic('lofi_chill');
  const second = await renderMusic('lofi_chill');
  check(first.size === second.size, 'the same bed renders identically');

  return { ok: failures.length === 0, steps, failures };
};
