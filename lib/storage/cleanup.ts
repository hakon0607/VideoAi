import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Client = SupabaseClient<Database>;

/**
 * Removes every object under a storage prefix, walking into subfolders.
 *
 * Supabase has no recursive delete and `list()` returns one level at a time,
 * so a project folder has to be walked. This is what makes deleting a project
 * actually free the space instead of only hiding the rows.
 */
export async function removePrefix(client: Client, bucket: string, prefix: string): Promise<number> {
  const files: string[] = [];
  const queue = [prefix];

  while (queue.length > 0) {
    const folder = queue.shift() as string;
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
    if (error || !data) continue;
    for (const entry of data) {
      const path = `${folder}/${entry.name}`;
      // Supabase marks folders by returning them without an id.
      if (entry.id === null) queue.push(path);
      else files.push(path);
    }
  }

  if (files.length === 0) return 0;
  // Delete in batches; one call only accepts so many paths.
  for (let i = 0; i < files.length; i += 100) {
    await client.storage.from(bucket).remove(files.slice(i, i + 100));
  }
  return files.length;
}

export async function removePaths(client: Client, bucket: string, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return 0;
  for (let i = 0; i < unique.length; i += 100) {
    await client.storage.from(bucket).remove(unique.slice(i, i + 100));
  }
  return unique.length;
}

export interface StoragePaths {
  mediaPaths: string[];
  exportPaths: string[];
}

export function parseStoragePaths(value: unknown): StoragePaths {
  const raw = (value ?? {}) as { mediaPaths?: unknown; exportPaths?: unknown };
  return {
    mediaPaths: Array.isArray(raw.mediaPaths) ? (raw.mediaPaths as string[]) : [],
    exportPaths: Array.isArray(raw.exportPaths) ? (raw.exportPaths as string[]) : [],
  };
}
