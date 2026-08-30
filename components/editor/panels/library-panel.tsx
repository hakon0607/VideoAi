'use client';

import { useCallback, useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Loader2, Music, Plus, Search } from 'lucide-react';
import type { MediaAsset } from '@/types/editor';
import { useEditorStore } from '@/lib/editor/store';
import { useMediaUrls } from '@/lib/editor/media-urls';
import { useI18n } from '@/lib/i18n/context';
import { formatClock } from '@/lib/utils/format';
import { addLibraryAssetToProject, searchLibrary, type LibraryAsset } from '@/lib/media/library';
import { resolveAssetUrl } from '@/lib/media/media-source';
import { writeMediaDrag } from '@/components/editor/timeline/drag-payload';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon } as const;
const KINDS = ['all', 'video', 'audio', 'image'] as const;

/**
 * The shared shelf.
 *
 * Everything here is one file on the server that every account can use, so
 * nobody has to upload a music bed that a hundred other people already have.
 * Adding one to a project does not copy it — the project just points at it.
 */
export function LibraryPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const projectId = useEditorStore((s) => s.state.projectId);
  const registerAsset = useEditorStore((s) => s.registerAsset);
  const assets = useEditorStore((s) => s.state.assets);
  const addUrl = useMediaUrls((s) => s.add);

  // The spinner is turned on where the query changes, not inside the effect:
  // a synchronous setState in an effect body just causes a second render.
  if (pending !== loading) setLoading(pending);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchLibrary(query, kind);
        if (!cancelled) {
          setItems(result);
          setError(null);
        }
      } catch (searchError) {
        if (!cancelled) setError(searchError instanceof Error ? searchError.message : String(searchError));
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, kind]);

  const add = useCallback(
    async (item: LibraryAsset): Promise<MediaAsset | null> => {
      // Already in this project? Reuse it rather than making a second row.
      const existing = assets.find((asset) => asset.storagePath.endsWith(item.storagePath));
      if (existing) return existing;

      setAddingId(item.id);
      try {
        const asset = await addLibraryAssetToProject(item, projectId, userId);
        registerAsset(asset);
        const url = await resolveAssetUrl(asset);
        if (url) addUrl(asset.id, url);
        return asset;
      } catch (addError) {
        setError(addError instanceof Error ? addError.message : String(addError));
        return null;
      } finally {
        setAddingId(null);
      }
    },
    [addUrl, assets, projectId, registerAsset, userId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPending(true);
            }}
            placeholder={t('editor.searchLibrary')}
            className="h-7 w-full rounded-sm border border-line bg-base pr-2 pl-6 text-[12px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {KINDS.map((id) => (
            <button
              key={id}
              onClick={() => {
                setKind(id);
                setPending(true);
              }}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] transition-colors',
                kind === id ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:text-ink',
              )}
            >
              {t(`library.kind.${id}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">{t('editor.libraryHint')}</p>

        {error && (
          <p className="mb-2 rounded-sm border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11.5px] text-danger">
            {error}
          </p>
        )}

        {loading && items.length === 0 && (
          <p className="mt-6 text-center text-[12px] text-ink-faint">
            <Loader2 size={13} className="mx-auto animate-spin-slow" />
          </p>
        )}

        {!loading && items.length === 0 && !error && (
          <p className="mt-6 text-center text-[12px] leading-relaxed text-ink-faint">{t('editor.libraryEmpty')}</p>
        )}

        <div className="space-y-1.5">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <div
                key={item.id}
                draggable
                onDragStart={async (event) => {
                  const asset = await add(item);
                  if (!asset) return;
                  writeMediaDrag(event, {
                    assetId: asset.id,
                    kind: asset.kind,
                    duration: asset.duration,
                    name: asset.name,
                  });
                }}
                className="group cursor-grab rounded-md border border-line bg-base p-2 transition-colors hover:border-line-strong active:cursor-grabbing"
              >
                <div className="flex gap-2.5">
                  <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded-sm bg-elevated">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-ink-faint">
                        <Icon size={14} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink">{item.name}</p>
                    <p className="mt-0.5 truncate text-[10.5px] text-ink-faint">
                      {item.duration > 0 ? `${formatClock(item.duration)} · ` : ''}
                      {item.license}
                    </p>
                    {item.attribution && (
                      <p className="mt-0.5 truncate text-[10px] text-ink-faint">{item.attribution}</p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  disabled={addingId === item.id}
                  onClick={() => void add(item)}
                >
                  {addingId === item.id ? (
                    <Loader2 size={11} className="animate-spin-slow" />
                  ) : (
                    <Plus size={11} />
                  )}
                  {t('editor.addToProject')}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
