'use client';

import { create } from 'zustand';

interface MediaUrlStore {
  /** assetId -> playable URL. Signed for cloud files, an object URL otherwise. */
  urls: Record<string, string>;
  /**
   * Assets whose file could not be found on this machine — a project opened
   * somewhere else, or storage the browser cleared. The editor shows these as
   * offline and offers to relink them rather than playing silence.
   */
  missing: string[];
  set: (urls: Record<string, string>) => void;
  add: (assetId: string, url: string) => void;
  remove: (assetId: string) => void;
  setMissing: (assetIds: string[]) => void;
  markFound: (assetId: string) => void;
}

export const useMediaUrls = create<MediaUrlStore>((set) => ({
  urls: {},
  missing: [],
  set: (urls) => set({ urls }),
  add: (assetId, url) =>
    set((s) => ({
      urls: { ...s.urls, [assetId]: url },
      missing: s.missing.filter((id) => id !== assetId),
    })),
  remove: (assetId) =>
    set((s) => {
      const next = { ...s.urls };
      delete next[assetId];
      return { urls: next };
    }),
  setMissing: (missing) => set({ missing }),
  markFound: (assetId) => set((s) => ({ missing: s.missing.filter((id) => id !== assetId) })),
}));
