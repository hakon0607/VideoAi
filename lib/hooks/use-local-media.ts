'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MediaAsset } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { rememberFile } from '@/lib/media/file-cache';
import { putLocalFile, requestPersistence } from '@/lib/media/local-store';
import { LOCAL_PREFIX, resolveAssetUrl } from '@/lib/media/media-source';

/**
 * Gives every asset in the project a playable URL.
 *
 * The server can only sign what is in the bucket. Local files and the built-in
 * sounds exist nowhere but this browser, so they are resolved here — and the
 * ones that cannot be found are reported rather than silently skipped, which is
 * the difference between "your footage is on the other laptop" and a preview
 * that is mysteriously black.
 */
export function useLocalMedia(): void {
  useEffect(() => {
    const resolve = async () => {
      const assets = useEditorStore.getState().state.assets;
      const known = useMediaUrls.getState().urls;
      const todo = assets.filter((asset) => !known[asset.id]);
      if (todo.length === 0) return;

      const found: Record<string, string> = {};
      const missing: string[] = [];
      await Promise.all(
        todo.map(async (asset) => {
          try {
            const url = await resolveAssetUrl(asset);
            if (url) found[asset.id] = url;
            else missing.push(asset.id);
          } catch {
            missing.push(asset.id);
          }
        }),
      );
      const store = useMediaUrls.getState();
      if (Object.keys(found).length) store.set({ ...store.urls, ...found });
      const stillMissing = [...new Set([...store.missing.filter((id) => !found[id]), ...missing])];
      store.setMissing(stillMissing);
    };

    void resolve().catch(() => undefined);
    // Re-run whenever the asset list changes, so an upload or an added sound
    // gets its URL without a reload.
    return useEditorStore.subscribe((current, previous) => {
      if (current.state.assets !== previous.state.assets) void resolve().catch(() => undefined);
    });
  }, []);
}

export interface RelinkResult {
  matched: number;
  unmatched: string[];
}

/**
 * Reattaches media that is not on this machine.
 *
 * Files are matched by name first and by size second, the way every editor does
 * it — the user picks the same footage from wherever it now lives, and the
 * timeline is untouched because the asset id never changed.
 */
export function useRelinkMedia(): {
  missing: MediaAsset[];
  relink: (files: FileList | File[]) => Promise<RelinkResult>;
  busy: boolean;
} {
  const missingIds = useMediaUrls((s) => s.missing);
  const assets = useEditorStore((s) => s.state.assets);
  const [busy, setBusy] = useState(false);

  const missing = assets.filter((asset) => missingIds.includes(asset.id));

  const relink = useCallback(
    async (files: FileList | File[]): Promise<RelinkResult> => {
      setBusy(true);
      try {
        await requestPersistence();
        const list = Array.from(files);
        const byName = new Map(list.map((file) => [file.name.toLowerCase(), file]));
        let matched = 0;
        const unmatched: string[] = [];

        for (const asset of missing) {
          const file =
            byName.get(asset.name.toLowerCase()) ??
            list.find((candidate) => candidate.size === asset.sizeBytes && asset.sizeBytes > 0);
          if (!file) {
            unmatched.push(asset.name);
            continue;
          }
          const id = asset.storagePath.startsWith(LOCAL_PREFIX)
            ? asset.storagePath.slice(LOCAL_PREFIX.length)
            : asset.id;
          await putLocalFile(id, file);
          rememberFile(asset.id, file);
          useMediaUrls.getState().add(asset.id, URL.createObjectURL(file));
          matched += 1;
        }
        return { matched, unmatched };
      } finally {
        setBusy(false);
      }
    },
    [missing],
  );

  return { missing, relink, busy };
}
