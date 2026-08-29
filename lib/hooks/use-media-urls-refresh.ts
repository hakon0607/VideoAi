'use client';

import { useEffect } from 'react';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { createClient } from '@/lib/supabase/client';

/** Signed URLs last an hour; re-sign well before that so playback never breaks. */
const REFRESH_MS = 45 * 60 * 1000;

export function useMediaUrlRefresh(): void {
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const assets = useEditorStore.getState().state.assets;
      if (assets.length === 0) return;
      const supabase = createClient();
      const { data } = await supabase.storage
        .from('media')
        .createSignedUrls(assets.map((a) => a.storagePath), 60 * 60);
      if (cancelled || !data) return;

      const byPath = new Map(data.map((item) => [item.path ?? '', item.signedUrl]));
      const next: Record<string, string> = { ...useMediaUrls.getState().urls };
      for (const asset of assets) {
        const url = byPath.get(asset.storagePath);
        if (url) next[asset.id] = url;
      }
      useMediaUrls.getState().set(next);
    };

    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
}
