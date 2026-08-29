'use client';

import type { Clip, EditorState, MediaClip } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { animatedValues } from '@/lib/editor/keyframes';
import { getTrack } from '@/lib/editor/selectors';
import type { Drawable, FrameProvider } from './compose';

type Element = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

interface Entry {
  element: Element;
  assetId: string;
  kind: MediaClip['kind'];
  ready: boolean;
}

/** Seeking is expensive, so only correct drift beyond this many seconds. */
const SEEK_TOLERANCE = 0.28;

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

  /** Creates elements for new clips and disposes the ones that are gone. */
  sync(clips: Clip[]): void {
    const live = new Set<string>();
    for (const clip of clips) {
      if (clip.kind === 'text') continue;
      const media = clip as MediaClip;
      live.add(media.id);
      const existing = this.entries.get(media.id);
      if (existing && existing.assetId === media.assetId) continue;
      if (existing) this.dispose(media.id);
      const url = this.urls.get(media.assetId);
      if (!url) continue;
      this.entries.set(media.id, this.createEntry(media, url));
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
      const entry: Entry = { element: img, assetId: clip.assetId, kind: clip.kind, ready: false };
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
    const entry: Entry = { element, assetId: clip.assetId, kind: clip.kind, ready: false };
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
    if (entry.element instanceof HTMLMediaElement) {
      entry.element.pause();
      entry.element.removeAttribute('src');
      entry.element.load();
    }
    this.entries.delete(clipId);
  }

  destroy(): void {
    for (const id of [...this.entries.keys()]) this.dispose(id);
  }

  /** True once every clip that is on screen right now has decodable data. */
  isReadyAt(state: EditorState, time: number): boolean {
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

  /**
   * Aligns every media element with the timeline: active clips are seeked (and
   * played, when the timeline is running), inactive ones are paused.
   */
  update(state: EditorState, time: number, playing: boolean): void {
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

      element.volume = this.computeVolume(state, media, time, local);
      element.muted = this.muted || media.muted || Boolean(getTrack(state, media.trackId)?.muted);

      // Backwards and frozen playback cannot be driven by the element's own
      // clock, so those are seeked frame by frame instead.
      const drivable = playing && !media.reversed && !media.freeze;
      if (drivable) {
        element.playbackRate = Math.min(16, Math.max(0.0625, media.speed));
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
    let gain = values.volume * (track?.volume ?? 1) * this.masterVolume;
    if (clip.fadeIn > 0 && local < clip.fadeIn) gain *= local / clip.fadeIn;
    const remaining = clipEnd(clip) - time;
    if (clip.fadeOut > 0 && remaining < clip.fadeOut) gain *= Math.max(0, remaining / clip.fadeOut);
    return Math.min(1, Math.max(0, gain));
  }

  pauseAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.element instanceof HTMLMediaElement && !entry.element.paused) entry.element.pause();
    }
  }
}
