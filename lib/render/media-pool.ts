'use client';

import type { Clip, EditorState, MediaClip } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { animatedValues } from '@/lib/editor/keyframes';
import { getTrack } from '@/lib/editor/selectors';
import type { Drawable, FrameProvider } from './compose';
import { buildCompressor, buildFilterChain, dbToGain, duckFactorAt } from './audio-graph';

type Element = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

interface Entry {
  element: Element;
  assetId: string;
  kind: MediaClip['kind'];
  ready: boolean;
  /** WebAudio routing, created the first time the clip actually plays. */
  audio: {
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    /** Signature of the processing the graph was built for. */
    signature: string;
  } | null;
}

/** Seeking is expensive, so only correct drift beyond this many seconds. */
const SEEK_TOLERANCE = 0.28;

/**
 * How many media elements may exist at once.
 *
 * Chrome refuses to create more than about seventy-five WebMediaPlayers per
 * tab; past that, every further <video> fails silently and the preview goes
 * black. A four-minute recording cut into pauses is easily two hundred clips,
 * so the pool keeps elements only for what is on or near the playhead and
 * disposes the rest. Twenty is comfortably more than any one instant needs
 * (one per track, plus a little lookahead) and comfortably under the limit.
 */
const MAX_ELEMENTS = 20;

/** Clips this far ahead of the playhead are loaded before they are needed. */
const LOOKAHEAD_SECONDS = 2.5;

/**
 * Owns one media element per clip and keeps it aligned with the playhead.
 *
 * Preview playback uses real <video>/<audio> elements: they give hardware
 * decoding and real audio for free. Export does not use this class at all — it
 * decodes frames precisely instead — but both feed the same compositor.
 */
export class MediaPool implements FrameProvider {
  private entries = new Map<string, Entry>();
  private urls = new Map<string, string>();
  private masterVolume = 1;
  private muted = false;
  private context: AudioContext | null = null;

  /**
   * The preview's audio graph.
   *
   * Routing through WebAudio rather than setting element.volume is what lets a
   * filter, a compressor and ducking behave in the preview exactly as they will
   * in the export — the same node types, the same parameters.
   */
  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  private processingSignature(clip: MediaClip): string {
    const audio = clip.audio;
    return `${audio.filter}|${audio.compression}`;
  }

  /** Builds (or rebuilds) the node chain for one clip. */
  private ensureAudioGraph(clip: MediaClip, entry: Entry): void {
    if (!(entry.element instanceof HTMLMediaElement)) return;
    const signature = this.processingSignature(clip);
    if (entry.audio && entry.audio.signature === signature) return;

    const context = this.getContext();
    if (!context) return;

    try {
      // A media element can only ever have one source node, so it is created
      // once and the chain behind it is rewired when the processing changes.
      const source = entry.audio?.source ?? context.createMediaElementSource(entry.element);
      source.disconnect();
      const gain = entry.audio?.gain ?? context.createGain();
      gain.disconnect();

      const chain = buildFilterChain(context, clip.audio.filter);
      const compressor = buildCompressor(context, clip.audio.compression);

      let head: AudioNode = source;
      if (chain) {
        head.connect(chain.input);
        head = chain.output;
      }
      if (compressor) {
        head.connect(compressor);
        head = compressor;
      }
      head.connect(gain);
      gain.connect(context.destination);

      entry.audio = { source, gain, signature };
    } catch {
      // Some browsers refuse a second source node for the same element. The
      // element's own volume is then the fallback, which still gets levels,
      // fades and ducking right — only the filters are lost.
      entry.audio = null;
    }
  }

  setUrls(urls: Map<string, string>): void {
    this.urls = urls;
    for (const [clipId, entry] of this.entries) {
      const url = urls.get(entry.assetId);
      if (url && entry.element.src !== url) {
        entry.element.src = url;
        entry.ready = false;
        void clipId;
      }
    }
  }

  setMasterVolume(volume: number, muted: boolean): void {
    this.masterVolume = volume;
    this.muted = muted;
  }

  /**
   * Notes the current clip list and drops elements for clips that are gone.
   *
   * Elements are *not* created here: on a long project that would be hundreds
   * of them at once. `ensureWindow` creates them as the playhead approaches.
   */
  sync(clips: Clip[]): void {
    const live = new Set<string>();
    for (const clip of clips) {
      if (clip.kind === 'text') continue;
      const media = clip as MediaClip;
      live.add(media.id);
      const existing = this.entries.get(media.id);
      if (existing && existing.assetId !== media.assetId) this.dispose(media.id);
    }
    for (const id of [...this.entries.keys()]) {
      if (!live.has(id)) this.dispose(id);
    }
  }

  private createEntry(clip: MediaClip, url: string): Entry {
    if (clip.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const entry: Entry = { element: img, assetId: clip.assetId, kind: clip.kind, ready: false, audio: null };
      img.onload = () => {
        entry.ready = true;
      };
      img.src = url;
      return entry;
    }

    const element = clip.kind === 'video' ? document.createElement('video') : document.createElement('audio');
    element.crossOrigin = 'anonymous';
    element.preload = 'auto';
    if (element instanceof HTMLVideoElement) element.playsInline = true;
    element.muted = false;
    const entry: Entry = { element, assetId: clip.assetId, kind: clip.kind, ready: false, audio: null };
    const markReady = () => {
      entry.ready = true;
    };
    element.addEventListener('loadeddata', markReady);
    element.addEventListener('canplay', markReady);
    element.src = url;
    element.load();
    return entry;
  }

  private dispose(clipId: string): void {
    const entry = this.entries.get(clipId);
    if (!entry) return;
    this.lastUsed.delete(clipId);
    if (entry.element instanceof HTMLMediaElement) {
      entry.element.pause();
      entry.element.removeAttribute('src');
      entry.element.load();
    }
    this.entries.delete(clipId);
  }

  destroy(): void {
    for (const id of [...this.entries.keys()]) this.dispose(id);
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  /** Playback speed for the preview only; it never touches the project. */
  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.1, Math.min(4, rate));
  }

  private playbackRate = 1;

  /**
   * True once every clip that is on screen right now has decodable data.
   * Creates the elements it needs first, so a caller can wait on a specific
   * moment (the thumbnail capture) without playing up to it.
   */
  isReadyAt(state: EditorState, time: number): boolean {
    this.ensureWindow(state, time);
    for (const clip of state.clips) {
      if (clip.kind === 'text') continue;
      if (time < clip.start || time >= clipEnd(clip)) continue;
      const entry = this.entries.get(clip.id);
      if (!entry || !entry.ready) return false;
    }
    return true;
  }

  getFrame(clip: MediaClip, sourceTime: number): Drawable | null {
    const entry = this.entries.get(clip.id);
    if (!entry || !entry.ready) return null;
    if (entry.element instanceof HTMLImageElement) return entry.element;
    if (entry.element instanceof HTMLVideoElement) {
      if (entry.element.readyState < 2) return null;
      void sourceTime;
      return entry.element;
    }
    return null;
  }

  getSize(clip: MediaClip): { width: number; height: number } | null {
    const entry = this.entries.get(clip.id);
    if (!entry) return null;
    if (entry.element instanceof HTMLImageElement) {
      return entry.element.naturalWidth ? { width: entry.element.naturalWidth, height: entry.element.naturalHeight } : null;
    }
    if (entry.element instanceof HTMLVideoElement) {
      return entry.element.videoWidth ? { width: entry.element.videoWidth, height: entry.element.videoHeight } : null;
    }
    return null;
  }

  /** When a clip last needed an element, so the oldest can be evicted first. */
  private lastUsed = new Map<string, number>();
  private tick = 0;

  /**
   * Keeps elements for what is on screen now and what is about to be, and
   * disposes the rest.
   *
   * This is what lets a two-hundred-clip project play at all: without it every
   * clip would hold a decoder, and the browser stops handing them out long
   * before that.
   */
  private ensureWindow(state: EditorState, time: number): void {
    this.tick += 1;
    const wanted: MediaClip[] = [];
    for (const clip of state.clips) {
      if (clip.kind === 'text') continue;
      const media = clip as MediaClip;
      const start = media.start;
      const end = clipEnd(media);
      // On screen now, or close enough that it should already be loading.
      if (end > time - 0.5 && start < time + LOOKAHEAD_SECONDS) {
        wanted.push(media);
        this.lastUsed.set(media.id, this.tick);
      }
    }

    for (const media of wanted) {
      if (this.entries.has(media.id)) continue;
      const url = this.urls.get(media.assetId);
      if (!url) continue;
      this.makeRoom(wanted.length);
      this.entries.set(media.id, this.createEntry(media, url));
    }

    // Anything well outside the window gives its decoder back.
    for (const id of [...this.entries.keys()]) {
      const used = this.lastUsed.get(id) ?? 0;
      if (this.tick - used > 90) {
        this.dispose(id);
        this.lastUsed.delete(id);
      }
    }
  }

  /** Evicts least-recently-needed clips until there is room for `needed`. */
  private makeRoom(needed: number): void {
    const limit = Math.max(MAX_ELEMENTS, needed + 2);
    if (this.entries.size < limit) return;
    const byAge = [...this.entries.keys()].sort(
      (a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0),
    );
    for (const id of byAge) {
      if (this.entries.size < limit) break;
      if ((this.lastUsed.get(id) ?? 0) === this.tick) continue; // needed right now
      this.dispose(id);
      this.lastUsed.delete(id);
    }
  }

  /**
   * Aligns every media element with the timeline: active clips are seeked (and
   * played, when the timeline is running), inactive ones are paused.
   */
  update(state: EditorState, time: number, playing: boolean): void {
    this.ensureWindow(state, time);
    for (const clip of state.clips) {
      if (clip.kind === 'text') continue;
      const media = clip as MediaClip;
      const entry = this.entries.get(media.id);
      if (!entry || !(entry.element instanceof HTMLMediaElement)) continue;

      const element = entry.element;
      const active = time >= media.start - 0.05 && time < clipEnd(media);
      if (!active) {
        if (!element.paused) element.pause();
        continue;
      }

      const local = time - media.start;
      const sourceTime = media.freeze
        ? media.sourceIn
        : media.reversed
          ? media.sourceIn + media.duration * media.speed - local * media.speed
          : media.sourceIn + local * media.speed;

      const level = this.computeVolume(state, media, time, local);
      const silenced = this.muted || media.muted || Boolean(getTrack(state, media.trackId)?.muted);

      this.ensureAudioGraph(media, entry);
      if (entry.audio) {
        // The element runs wide open; the graph owns the level.
        element.volume = 1;
        element.muted = false;
        entry.audio.gain.gain.value = silenced ? 0 : level;
      } else {
        element.volume = Math.min(1, level);
        element.muted = silenced;
      }

      // Backwards and frozen playback cannot be driven by the element's own
      // clock, so those are seeked frame by frame instead.
      const drivable = playing && !media.reversed && !media.freeze;
      if (drivable) {
        element.playbackRate = Math.min(16, Math.max(0.0625, media.speed * this.playbackRate));
        if (Math.abs(element.currentTime - sourceTime) > SEEK_TOLERANCE) {
          element.currentTime = Math.max(0, sourceTime);
        }
        if (element.paused) void element.play().catch(() => undefined);
      } else {
        if (!element.paused) element.pause();
        if (Math.abs(element.currentTime - sourceTime) > 0.02) {
          element.currentTime = Math.max(0, sourceTime);
        }
      }
    }
  }

  private computeVolume(state: EditorState, clip: MediaClip, time: number, local: number): number {
    const track = getTrack(state, clip.trackId);
    const values = animatedValues(clip, local);
    let gain = values.volume * (track?.volume ?? 1) * this.masterVolume * dbToGain(clip.audio.gainDb ?? 0);
    if (clip.fadeIn > 0 && local < clip.fadeIn) gain *= local / clip.fadeIn;
    const remaining = clipEnd(clip) - time;
    if (clip.fadeOut > 0 && remaining < clip.fadeOut) gain *= Math.max(0, remaining / clip.fadeOut);
    gain *= duckFactorAt(state, clip, time);
    return Math.max(0, Math.min(4, gain));
  }

  pauseAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.element instanceof HTMLMediaElement && !entry.element.paused) entry.element.pause();
    }
  }
}
