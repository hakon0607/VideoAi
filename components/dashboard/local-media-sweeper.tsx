'use client';

import { useEffect } from 'react';
import { listOwnedAssetIdsAction } from '@/lib/actions/projects';
import { sweepOrphans } from '@/lib/media/local-store';

/**
 * Gives back the disk a deleted project was using.
 *
 * Deleting a project removes its rows, but the media lives on whichever machine
 * uploaded it, and no server can reach in there. So the browser checks its own
 * storage against what the account still owns, once per visit to the dashboard,
 * and drops anything the server has forgotten.
 */
export function LocalMediaSweeper() {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const keep = await listOwnedAssetIdsAction();
        if (cancelled) return;
        await sweepOrphans(keep);
      } catch {
        // Housekeeping. Never worth interrupting anyone over.
      }
    };
    // After the page has settled, so it never competes with the first paint.
    const timer = window.setTimeout(() => void run(), 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
