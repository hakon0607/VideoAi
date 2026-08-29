'use client';

import { create } from 'zustand';

interface MediaUrlStore {
  /** assetId -> signed URL. Refreshed before the hour-long signature expires. */
  urls: Record<string, string>;
  set: (urls: Record<string, string>) => void;
  add: (assetId: string, url: string) => void;
  remove: (assetId: string) => void;
}

export const useMediaUrls = create<MediaUrlStore>((set) => ({
  urls: {},
  set: (urls) => set({ urls }),
  add: (assetId, url) => set((s) => ({ urls: { ...s.urls, [assetId]: url } })),
  remove: (assetId) =>
    set((s) => {
      const next = { ...s.urls };
      delete next[assetId];
      return { urls: next };
    }),
}));
