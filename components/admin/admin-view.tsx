'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, HardDrive, Infinity as InfinityIcon, Search, Shield, Trash2 } from 'lucide-react';
import type { Views } from '@/types/database';
import type { AdminData, OrphanedFile } from '@/lib/actions/admin';
import {
  deleteOrphanedFilesAction,
  deleteProjectAsAdminAction,
  findOrphanedFilesAction,
  setCreditCostAction,
} from '@/lib/actions/admin';
import { useI18n } from '@/lib/i18n/context';
import { formatBytes, formatClock, relativeTime } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { StatGrid } from './stat-grid';
import { DataTable, type Column } from './data-table';
import { UserEditor } from './user-editor';

type Tab = 'overview' | 'users' | 'projects' | 'media' | 'credits' | 'storage';

const TABS: { id: Tab; key: Parameters<ReturnType<typeof useI18n>['t']>[0] }[] = [
  { id: 'overview', key: 'admin.tab.overview' },
  { id: 'users', key: 'admin.tab.users' },
  { id: 'projects', key: 'admin.tab.projects' },
  { id: 'media', key: 'admin.tab.media' },
  { id: 'credits', key: 'admin.tab.credits' },
  { id: 'storage', key: 'admin.tab.storage' },
];

export function AdminView({ data }: { data: AdminData }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Views<'admin_users'> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const num = (value: number) => value.toLocaleString(locale);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.users;
    return data.users.filter(
      (user) =>
        (user.email ?? '').toLowerCase().includes(needle) ||
        (user.username ?? '').toLowerCase().includes(needle),
    );
  }, [data.users, query]);

  const deleteProject = (projectId: string, name: string) => {
    if (!window.confirm(t('admin.deleteProjectConfirm', { name }))) return;
    startTransition(async () => {
      const result = await deleteProjectAsAdminAction(projectId);
      setNotice(result.ok ? (result.message ?? null) : (result.error ?? null));
      router.refresh();
    });
  };

  /* ---------------------------------------------------------------- users */
  const userColumns: Column<Views<'admin_users'>>[] = [
    {
      key: 'user',
      header: t('admin.col.user'),
      render: (user) => (
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-elevated text-[10px] font-semibold">
            {(user.username ?? user.email ?? '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-ink">{user.username ?? '—'}</span>
              {user.is_admin && (
                <span className="inline-flex items-center gap-0.5 rounded-xs bg-accent-soft px-1 py-px text-[9.5px] font-medium text-accent">
                  <Shield size={8} /> Admin
                </span>
              )}
            </span>
            <span className="block truncate text-[11px] text-ink-faint">{user.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'credits',
      header: t('admin.col.credits'),
      numeric: true,
      render: (user) =>
        user.credits_unlimited ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <InfinityIcon size={12} /> {t('admin.unlimited')}
          </span>
        ) : (
          <span className={cn((user.credits ?? 0) < 250 ? 'text-warning' : 'text-ink')}>{num(user.credits ?? 0)}</span>
        ),
    },
    { key: 'projects', header: t('admin.col.projects'), numeric: true, render: (u) => num(u.project_count ?? 0) },
    {
      key: 'storage',
      header: t('admin.col.storage'),
      numeric: true,
      render: (u) => formatBytes(Number(u.bytes_used ?? 0)),
    },
    { key: 'ai', header: t('admin.col.ai'), numeric: true, render: (u) => num(u.ai_requests ?? 0) },
    {
      key: 'joined',
      header: t('admin.col.joined'),
      render: (u) => (u.signed_up_at ? relativeTime(u.signed_up_at, locale) : '—'),
    },
    {
      key: 'seen',
      header: t('admin.col.lastSeen'),
      render: (u) => (u.last_sign_in_at ? relativeTime(u.last_sign_in_at, locale) : '—'),
    },
  ];

  /* ------------------------------------------------------------- projects */
  const projectColumns: Column<Views<'admin_projects'>>[] = [
    {
      key: 'project',
      header: t('admin.col.project'),
      render: (project) => (
        <Link href={`/editor/${project.project_id}`} className="text-ink hover:text-accent">
          {project.project_name}
          <span className="ml-1.5 text-[10.5px] text-ink-faint">{project.aspect_ratio}</span>
        </Link>
      ),
    },
    {
      key: 'owner',
      header: t('admin.col.owner'),
      render: (project) => (
        <span className="block">
          <span className="block text-ink">{project.owner_username ?? '—'}</span>
          <span className="block text-[11px] text-ink-faint">{project.owner_email}</span>
        </span>
      ),
    },
    {
      key: 'duration',
      header: t('admin.col.duration'),
      numeric: true,
      render: (p) => formatClock(Number(p.duration_seconds ?? 0)),
    },
    { key: 'clips', header: t('admin.stat.clips'), numeric: true, render: (p) => num(p.clip_count ?? 0) },
    {
      key: 'size',
      header: t('admin.col.size'),
      numeric: true,
      render: (p) => formatBytes(Number(p.bytes_used ?? 0)),
    },
    { key: 'ai', header: t('admin.col.ai'), numeric: true, render: (p) => num(p.ai_edits ?? 0) },
    {
      key: 'updated',
      header: t('admin.col.updated'),
      render: (p) => (p.updated_at ? relativeTime(p.updated_at, locale) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (project) => (
        <button
          onClick={() => deleteProject(project.project_id as string, project.project_name as string)}
          title={t('admin.deleteProject')}
          className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  /* ---------------------------------------------------------------- media */
  const mediaColumns: Column<Views<'admin_media'>>[] = [
    {
      key: 'file',
      header: t('admin.col.file'),
      render: (media) => (
        <span className="block">
          <span className="block truncate text-ink">{media.file_name}</span>
          <span className="block truncate font-mono text-[10.5px] text-ink-faint">{media.storage_path}</span>
        </span>
      ),
    },
    { key: 'owner', header: t('admin.col.owner'), render: (m) => m.owner_email },
    { key: 'project', header: t('admin.col.project'), render: (m) => m.project_name },
    {
      key: 'size',
      header: t('admin.col.size'),
      numeric: true,
      render: (m) => formatBytes(Number(m.size_bytes ?? 0)),
    },
    {
      key: 'duration',
      header: t('admin.col.duration'),
      numeric: true,
      render: (m) => (Number(m.duration_seconds) > 0 ? formatClock(Number(m.duration_seconds)) : '—'),
    },
    {
      key: 'status',
      header: t('admin.col.status'),
      render: (m) => (
        <span
          className={cn(
            'rounded-xs px-1.5 py-px text-[10.5px]',
            m.analysis_status === 'analyzed'
              ? 'bg-positive/15 text-positive'
              : m.analysis_status === 'failed'
                ? 'bg-danger/15 text-danger'
                : 'bg-elevated text-ink-faint',
          )}
        >
          {m.analysis_status}
        </span>
      ),
    },
  ];

  /* -------------------------------------------------------------- credits */
  const activityColumns: Column<Views<'admin_credit_activity'>>[] = [
    { key: 'user', header: t('admin.col.user'), render: (a) => a.username ?? a.user_email },
    { key: 'reason', header: t('admin.col.reason'), render: (a) => a.reason },
    {
      key: 'delta',
      header: t('admin.col.change'),
      numeric: true,
      render: (a) => (
        <span className={cn(Number(a.delta) > 0 ? 'text-positive' : Number(a.delta) < 0 ? 'text-ink-muted' : 'text-ink-faint')}>
          {Number(a.delta) > 0 ? '+' : ''}
          {num(Number(a.delta ?? 0))}
        </span>
      ),
    },
    { key: 'balance', header: t('admin.col.balance'), numeric: true, render: (a) => num(Number(a.balance_after ?? 0)) },
    { key: 'project', header: t('admin.col.project'), render: (a) => a.project_name ?? '—' },
    {
      key: 'when',
      header: t('admin.col.when'),
      render: (a) => (a.created_at ? relativeTime(a.created_at, locale) : '—'),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight text-ink">
            <Shield size={17} className="text-accent" /> {t('admin.title')}
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t('admin.subtitle')}</p>
        </div>
      </div>

      {!data.hasServiceRole && (
        <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('admin.noServiceRole')}
        </p>
      )}

      {notice && (
        <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 text-[12.5px] text-ink">{notice}</p>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map(({ id, key }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'relative px-3 py-2 text-[13px] transition-colors',
              tab === id ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t(key)}
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="space-y-4">
          <StatGrid
            stats={[
              { label: t('admin.stat.users'), value: num(data.overview.users), hint: `${num(data.overview.admins)} ${t('admin.stat.admins').toLowerCase()}` },
              { label: t('admin.stat.projects'), value: num(data.overview.projects), hint: `${num(data.overview.clips)} ${t('admin.stat.clips').toLowerCase()}` },
              { label: t('admin.stat.storage'), value: formatBytes(data.overview.bytesUsed), hint: `${num(data.overview.assets)} ${t('admin.stat.assets').toLowerCase()}`, accent: true },
              { label: t('admin.stat.creditsSpent'), value: num(data.overview.creditsSpent) },
            ]}
          />
          <StatGrid
            stats={[
              { label: t('admin.stat.aiRequests'), value: num(data.overview.aiRequests) },
              { label: t('admin.stat.aiEdits'), value: num(data.overview.aiEdits) },
              { label: t('admin.stat.exports'), value: num(data.overview.exports) },
              { label: t('admin.stat.activeToday'), value: num(data.overview.activeToday), hint: `${num(data.overview.signupsWeek)} ${t('admin.stat.signupsWeek').toLowerCase()}` },
            ]}
          />
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.searchUsers')}
              className="pl-8.5"
            />
          </div>
          <DataTable
            rows={filteredUsers}
            columns={userColumns}
            rowKey={(user) => user.user_id as string}
            empty={t('admin.empty')}
            onRowClick={setEditing}
          />
        </div>
      )}

      {tab === 'projects' && (
        <DataTable
          rows={data.projects}
          columns={projectColumns}
          rowKey={(project) => project.project_id as string}
          empty={t('admin.empty')}
        />
      )}

      {tab === 'media' && (
        <DataTable
          rows={data.media}
          columns={mediaColumns}
          rowKey={(media) => media.asset_id as string}
          empty={t('admin.empty')}
        />
      )}

      {tab === 'credits' && (
        <div className="space-y-5">
          <section>
            <h2 className="mb-1 text-[13px] font-medium text-ink">{t('admin.prices.title')}</h2>
            <p className="mb-2.5 text-[12px] text-ink-muted">{t('admin.prices.hint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.costs.map((cost) => (
                <CostRow key={cost.key} cost={cost} />
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2.5 text-[13px] font-medium text-ink">{t('admin.tab.credits')}</h2>
            <DataTable
              rows={data.activity}
              columns={activityColumns}
              rowKey={(row) => row.id as string}
              empty={t('admin.empty')}
            />
          </section>
        </div>
      )}

      {tab === 'storage' && <StorageTab hasServiceRole={data.hasServiceRole} />}

      {/* Keyed so the form is rebuilt from the row you clicked, rather than
          holding the values it was first mounted with. */}
      <UserEditor
        key={editing?.user_id ?? 'none'}
        user={editing}
        currentUserId={data.currentUserId}
        onClose={() => setEditing(null)}
      />
      {pending && <p className="text-[12px] text-ink-faint">{t('common.loading')}</p>}
    </div>
  );
}

function CostRow({ cost }: { cost: { key: string; cost: number; description: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(String(cost.cost));
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const next = Number(value);
    if (!Number.isFinite(next) || next === cost.cost) return;
    setSaving(true);
    await setCreditCostAction(cost.key, Math.max(0, Math.round(next)));
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[11.5px] text-ink">{cost.key}</span>
        <span className="block text-[11px] leading-tight text-ink-faint">{cost.description}</span>
      </span>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && void commit()}
        className="w-24 text-right"
        aria-label={cost.key}
      />
      {saving && <span className="text-[11px] text-ink-faint">{t('common.saving')}</span>}
    </div>
  );
}

function StorageTab({ hasServiceRole }: { hasServiceRole: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<OrphanedFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setBusy(true);
    setError(null);
    const result = await findOrphanedFilesAction();
    setFiles(result.files);
    if (result.error) setError(result.error);
    setBusy(false);
  };

  const purge = async () => {
    if (!files?.length) return;
    setBusy(true);
    const result = await deleteOrphanedFilesAction(files);
    if (!result.ok) setError(result.error ?? null);
    else setFiles([]);
    setBusy(false);
    router.refresh();
  };

  const total = (files ?? []).reduce((sum, file) => sum + (file.size ?? 0), 0);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <HardDrive size={14} /> {t('admin.storage.title')}
        </h2>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-muted">{t('admin.storage.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={scan} loading={busy}>
          {t('admin.storage.scan')}
        </Button>
        {files !== null && files.length > 0 && (
          <Button variant="danger" onClick={purge} loading={busy} disabled={!hasServiceRole}>
            <Trash2 size={13} /> {t('admin.storage.deleteAll', { count: files.length })} · {formatBytes(total)}
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
      )}

      {files !== null && files.length === 0 && !error && (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[12.5px] text-positive">
          {t('admin.storage.none')}
        </p>
      )}

      {files !== null && files.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {files.slice(0, 200).map((file) => (
            <li key={`${file.bucket}/${file.path}`} className="flex items-center justify-between gap-3 bg-base px-3 py-2">
              <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-muted">
                <span className="text-ink-faint">{file.bucket}/</span>
                {file.path}
              </span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-ink-faint">
                {file.size ? formatBytes(file.size) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
