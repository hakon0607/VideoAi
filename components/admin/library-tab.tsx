'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LibraryBig, Loader2, Trash2, Upload } from 'lucide-react';
import type { MediaAsset } from '@/types/editor';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';
import { classifyFile } from '@/lib/media/upload';
import { probeImage, probeVideoOrAudio } from '@/lib/media/probe';
import { formatBytes, formatClock } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Row {
  id: string;
  kind: string;
  name: string;
  category: string;
  license: string;
  attribution: string | null;
  size_bytes: number;
  duration_seconds: number;
  storage_path: string;
}

/**
 * The shelf, from the curator's side.
 *
 * What goes here is served to every user, so the licence field is not optional
 * paperwork — most "free" stock sites forbid re-hosting their files inside
 * another product. Safe to put here: CC0 and public domain, your own
 * recordings, and CC-BY as long as the credit line is filled in.
 */
export function LibraryTab() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [license, setLicense] = useState('CC0');
  const [attribution, setAttribution] = useState('');
  const [category, setCategory] = useState('music');

  // A counter rather than a callback dependency: reloading is "fetch again",
  // and the fetch itself lives inside the effect where it belongs.
  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from('library_assets')
        .select('id,kind,name,category,license,attribution,size_bytes,duration_seconds,storage_path')
        .order('created_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      else setRows((data ?? []) as unknown as Row[]);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const upload = useCallback(
    async (files: FileList) => {
      setBusy(true);
      setError(null);
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();

      for (const file of Array.from(files)) {
        setProgress(file.name);
        try {
          const kind = classifyFile(file) as MediaAsset['kind'] | null;
          if (!kind) throw new Error(`${file.name}: unsupported file type`);
          const probe = kind === 'image' ? await probeImage(file) : await probeVideoOrAudio(file);
          const extension = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `${category}/${crypto.randomUUID()}.${extension}`;

          const { error: uploadError } = await supabase.storage
            .from('library')
            .upload(path, file, { upsert: false, contentType: file.type || undefined });
          if (uploadError) throw new Error(uploadError.message);

          const { error: insertError } = await supabase.from('library_assets').insert({
            kind,
            name: file.name.replace(/\.[^.]+$/, ''),
            category,
            tags: file.name.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9æøå]+/i).filter(Boolean),
            storage_path: path,
            mime_type: file.type || `${kind}/unknown`,
            size_bytes: file.size,
            duration_seconds: probe.duration,
            width: probe.width,
            height: probe.height,
            has_audio: probe.hasAudio,
            thumbnail_url: probe.thumbnail,
            license,
            attribution: attribution.trim() || null,
            added_by: auth.user?.id ?? null,
          });
          if (insertError) throw new Error(insertError.message);
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
        }
      }

      setProgress(null);
      setBusy(false);
      load();
    },
    [attribution, category, license, load],
  );

  const remove = useCallback(
    async (row: Row) => {
      if (!window.confirm(`${t('common.delete')} "${row.name}"?`)) return;
      const supabase = createClient();
      await supabase.storage.from('library').remove([row.storage_path]);
      const { error: deleteError } = await supabase.from('library_assets').delete().eq('id', row.id);
      if (deleteError) setError(deleteError.message);
      load();
    },
    [load, t],
  );

  const total = rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <LibraryBig size={14} /> {t('admin.library.title')}
        </h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-muted">{t('admin.library.hint')}</p>
      </div>

      <div className="grid gap-2 rounded-md border border-line bg-surface p-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[11px] text-ink-muted">{t('admin.library.category')}</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 w-full rounded-sm border border-line bg-base px-2 text-[12px] text-ink"
          >
            {['music', 'sfx', 'video', 'image', 'other'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-ink-muted">{t('admin.library.license')}</span>
          <select
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            className="h-8 w-full rounded-sm border border-line bg-base px-2 text-[12px] text-ink"
          >
            {['CC0', 'Public domain', 'CC-BY', 'Own work', 'Licensed'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-ink-muted">{t('admin.library.attribution')}</span>
          <Input value={attribution} onChange={(e) => setAttribution(e.target.value)} placeholder="Kevin MacLeod" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => inputRef.current?.click()} loading={busy}>
          <Upload size={13} /> {t('admin.library.upload')}
        </Button>
        <span className="text-[12px] text-ink-faint">
          {rows.length} · {formatBytes(total)}
        </span>
        {progress && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <Loader2 size={12} className="animate-spin-slow" /> {progress}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="rounded-sm border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">{error}</p>
      )}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[12px]">
          <thead className="bg-surface text-left text-ink-faint">
            <tr>
              <th className="px-2.5 py-2 font-medium">{t('admin.library.name')}</th>
              <th className="px-2.5 py-2 font-medium">{t('admin.library.category')}</th>
              <th className="px-2.5 py-2 font-medium">{t('admin.library.license')}</th>
              <th className="px-2.5 py-2 font-medium">{t('admin.library.size')}</th>
              <th className="px-2.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/60 text-ink-muted">
                <td className="px-2.5 py-1.5 text-ink">
                  {row.name}
                  {row.attribution && <span className="ml-1.5 text-[11px] text-ink-faint">— {row.attribution}</span>}
                </td>
                <td className="px-2.5 py-1.5">{row.category}</td>
                <td className="px-2.5 py-1.5">{row.license}</td>
                <td className="px-2.5 py-1.5 tabular-nums">
                  {Number(row.duration_seconds) > 0 ? `${formatClock(Number(row.duration_seconds))} · ` : ''}
                  {formatBytes(Number(row.size_bytes))}
                </td>
                <td className="px-2.5 py-1.5 text-right">
                  <button
                    onClick={() => void remove(row)}
                    aria-label={t('common.delete')}
                    className="rounded-xs p-1 text-ink-faint transition-colors hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2.5 py-6 text-center text-ink-faint">
                  {t('admin.library.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
