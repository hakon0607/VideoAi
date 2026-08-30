'use client';

import { useState } from 'react';
import { Sparkles, SlidersHorizontal } from 'lucide-react';
import type { EditorBootstrap } from '@/lib/actions/editor-data';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { cn } from '@/lib/utils/cn';
import { AssistantPanel } from '@/components/editor/ai/assistant-panel';
import { PropertiesPanel } from './properties-panel';

/**
 * Assistant and inspector share the right column. Selecting a clip for the
 * first time reveals the inspector, which is what people expect; after that the
 * tab stays where they put it.
 */
export function RightPanel({
  projectId,
  conversationId,
  initialMessages,
}: {
  projectId: string;
  conversationId: string | null;
  initialMessages: EditorBootstrap['messages'];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'ai' | 'inspector'>('ai');
  const selectionCount = useEditorStore((s) => s.selection.clipIds.length);
  const [previousCount, setPreviousCount] = useState(selectionCount);

  if (selectionCount !== previousCount) {
    setPreviousCount(selectionCount);
    if (previousCount === 0 && selectionCount > 0) setTab('inspector');
  }

  const tabs = [
    { id: 'ai' as const, icon: Sparkles, label: t('editor.assistant') },
    { id: 'inspector' as const, icon: SlidersHorizontal, label: t('editor.inspector') },
  ];

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-surface">
      <nav className="flex h-9 shrink-0 border-b border-line" role="tablist">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 text-[12px] transition-colors',
              tab === id ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            <Icon size={12} className={tab === id && id === 'ai' ? 'text-accent' : undefined} />
            {label}
            {tab === id && <span className="absolute inset-x-3 bottom-0 h-px bg-accent" />}
          </button>
        ))}
      </nav>

      {/* The assistant stays mounted so a running request survives a tab switch. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', tab === 'ai' ? '' : 'hidden')}>
        <AssistantPanel
          projectId={projectId}
          conversationId={conversationId}
          initialMessages={initialMessages}
        />
      </div>
      {tab === 'inspector' && <PropertiesPanel />}
    </aside>
  );
}
