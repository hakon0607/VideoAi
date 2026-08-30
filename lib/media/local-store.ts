'use client';

/**
 * Media lives on this machine, not in the cloud.
 *
 * Video is the one thing in this app that is genuinely big, and hosted storage
 * is priced accordingly — a handful of clips can fill a free plan. Since the
 * browser already has the file the moment it is dropped in, and every part of
 * the editor (preview, analysis, export) reads it locally anyway, the upload
 * was only ever paying for the ability to open the project somewhere else.
 *
 * So the bytes stay here. The database keeps the row that describes the file —
 * name, duration, resolution, waveform — which is a few hundred bytes, and the
 * timeline keeps working exactly as before.
 *
 * Two backends: the Origin Private File System where it exists (fast, made for
 * this, streams without loading the whole file into memory), and IndexedDB
 * everywhere else.
 */

const DIRECTORY = 'videoai-media';
const DB_NAME = 'videoai-media';
const DB_STORE = 'files';

export interface StorageUsage {
  /** Bytes this origin is using, as the browser reports it. */
  used: number;
  /** Bytes the browser is willing to give this origin. */
  quota: number;
  /** True once the browser has promised not to evict the data on its own. */
  persistent: boolean;
}

function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function opfsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
  });
}

function idbRequest<T>(store: IDBObjectStore, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local storage request failed.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(DB_STORE, mode);
    return await run(transaction.objectStore(DB_STORE));
  } finally {
    db.close();
  }
}

/**
 * Asks the browser to stop treating this data as disposable.
 *
 * Without it, "best effort" storage can be cleared when the disk gets full,
 * and the user's footage would quietly vanish. Chrome grants it silently to
 * installed or frequently visited sites; Firefox asks. Either way, failing to
 * get it is not fatal — the files are still written.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function putLocalFile(assetId: string, file: Blob): Promise<void> {
  if (hasOpfs()) {
    const directory = await opfsDirectory();
    const handle = await directory.getFileHandle(assetId, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return;
  }
  await withStore('readwrite', (store) => idbRequest(store, (s) => s.put(file, assetId)));
}

export async function getLocalFile(assetId: string): Promise<Blob | null> {
  if (hasOpfs()) {
    try {
      const directory = await opfsDirectory();
      const handle = await directory.getFileHandle(assetId);
      return await handle.getFile();
    } catch {
      return null;
    }
  }
  try {
    const value = await withStore('readonly', (store) =>
      idbRequest<Blob | undefined>(store, (s) => s.get(assetId) as IDBRequest<Blob | undefined>),
    );
    return value ?? null;
  } catch {
    return null;
  }
}

export async function hasLocalFile(assetId: string): Promise<boolean> {
  if (hasOpfs()) {
    try {
      const directory = await opfsDirectory();
      await directory.getFileHandle(assetId);
      return true;
    } catch {
      return false;
    }
  }
  const value = await getLocalFile(assetId);
  return value !== null;
}

export async function deleteLocalFile(assetId: string): Promise<void> {
  if (hasOpfs()) {
    try {
      const directory = await opfsDirectory();
      await directory.removeEntry(assetId);
    } catch {
      // Already gone is the outcome we wanted.
    }
    return;
  }
  try {
    await withStore('readwrite', (store) => idbRequest(store, (s) => s.delete(assetId)));
  } catch {
    // Same.
  }
}

/** Every asset id this machine holds a file for. */
export async function listLocalFiles(): Promise<string[]> {
  if (hasOpfs()) {
    try {
      const directory = await opfsDirectory();
      const ids: string[] = [];
      // @ts-expect-error - the async iterator is standard but not in the DOM types yet.
      for await (const [name] of directory.entries()) ids.push(name as string);
      return ids;
    } catch {
      return [];
    }
  }
  try {
    const keys = await withStore('readonly', (store) =>
      idbRequest<IDBValidKey[]>(store, (s) => s.getAllKeys()),
    );
    return keys.map(String);
  } catch {
    return [];
  }
}

export async function localStorageUsage(): Promise<StorageUsage> {
  const fallback: StorageUsage = { used: 0, quota: 0, persistent: false };
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return fallback;
    const estimate = await navigator.storage.estimate();
    const persistent = (await navigator.storage.persisted?.()) ?? false;
    return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent };
  } catch {
    return fallback;
  }
}

/**
 * Removes files for assets that no longer belong to any of the user's projects.
 *
 * Deleting a project on another device cannot reach into this machine, so the
 * sweep runs here: anything the server no longer knows about is not worth the
 * disk it sits on.
 */
export async function sweepOrphans(keepAssetIds: Iterable<string>): Promise<number> {
  const keep = new Set(keepAssetIds);
  const present = await listLocalFiles();
  let removed = 0;
  for (const id of present) {
    if (keep.has(id)) continue;
    await deleteLocalFile(id);
    removed += 1;
  }
  return removed;
}
