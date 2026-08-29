'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Download, Keyboard, Loader2, Redo2, Settings2, Undo2 } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { SHORTCUT_HINTS } from '@/lib/hooks/use-shortcuts';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Modal } from '@/components/ui/modal';
import { CreditBadge } from '@/components/dashboard/credit-badge';
import { ProfileMenu } from '@/components/dashboard/profile-menu';
import { ProjectSettingsDialog } from './project-settings-dialog';
import { cn } from '@/lib/utils/cn';

export function Topbar({
  user,
  onSave,
  onExport,
}: {
  user: { id: string; email: string; displayName: string; username: string };
  onSave: () => void;
  onExport: () => void;
}) {
  const { t } = useI18n();
  const name = useEditorStore((s) => s.state.name);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const saveError = useEditorStore((s) => s.saveError);
  const dispatch = useEditorStore((s) => s.dispatch);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const [draftName, setDraftName] = useState(name);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const [lastName, setLastName] = useState(name);
  if (name !== lastName) {
    setLastName(name);
    setDraftName(name);
  }
  useEffect(() => useEditorStore.subscribe((s, p) => s.history !== p.history && setHistoryVersion((v) => v + 1)), []);

  const canUndo = useEditorStore.getState().canUndo();
  const canRedo = useEditorStore.getState().canRedo();
  void historyVersion;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <Tooltip label={t('editor.backToDashboard')} side="bottom">
        <Link
          href="/dashboard"
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <ArrowLeft size={15} />
        </Link>
      </Tooltip>

      <span className="grid h-6 w-6 place-items-center rounded-sm bg-accent text-[11px] font-bold text-white">V</span>

      <input
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onBlur={() => {
          if (draftName.trim() && draftName !== name) {
            dispatch([{ type: 'set_project_name', params: { name: draftName.trim() } }], { label: 'Rename project' });
          } else {
            setDraftName(name);
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-8 min-w-0 max-w-64 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-ink transition-colors hover:border-line focus:border-accent focus:outline-none"
      />

      <div className="flex items-center">
        <Tooltip label={t('common.undo')} shortcut="⌘Z" side="bottom">
          <button
            onClick={() => undo()}
            disabled={!canUndo}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-30"
          >
            <Undo2 size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('common.redo')} shortcut="⌘⇧Z" side="bottom">
          <button
            onClick={() => redo()}
            disabled={!canRedo}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-30"
          >
            <Redo2 size={14} />
          </button>
        </Tooltip>
      </div>

      <span
        className={cn(
          'ml-1 inline-flex items-center gap-1.5 text-[11.5px]',
          saveStatus === 'error' ? 'text-danger' : 'text-ink-faint',
        )}
        title={saveError ?? undefined}
      >
        {saveStatus === 'saving' ? (
          <>
            <Loader2 size={11} className="animate-spin-slow" /> {t('common.saving')}
          </>
        ) : saveStatus === 'saved' ? (
          <>
            <Check size={11} className="text-positive" /> {t('common.saved')}
          </>
        ) : saveStatus === 'error' ? (
          <>{t('common.saveFailed')}</>
        ) : saveStatus === 'dirty' ? (
          <>·</>
        ) : null}
      </span>

      <div className="flex-1" />

      <CreditBadge compact />

      <Tooltip label={t('editor.shortcuts')} side="bottom">
        <button
          onClick={() => setShortcutsOpen(true)}
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <Keyboard size={14} />
        </button>
      </Tooltip>

      <Tooltip label={t('editor.projectSettings')} side="bottom">
        <button
          onClick={() => setSettingsOpen(true)}
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
        >
          <Settings2 size={14} />
        </button>
      </Tooltip>

      <Button size="sm" onClick={onSave}>
        {t('common.save')}
      </Button>
      <Button size="sm" variant="primary" onClick={onExport}>
        <Download size={13} /> {t('editor.export')}
      </Button>

      <ProfileMenu displayName={user.displayName} username={user.username} email={user.email} />

      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title={t('editor.shortcuts')} width="sm">
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
          {SHORTCUT_HINTS.map((hint) => (
            <li key={hint.keys} className="flex items-center justify-between bg-base px-3 py-2 text-[12.5px]">
              <span className="text-ink-muted">{hint.action}</span>
              <kbd className="rounded-xs border border-line-strong bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-ink">
                {hint.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Modal>

      <ProjectSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
