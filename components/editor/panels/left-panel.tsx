'use client';

import { useState } from 'react';
import { Film, Layers, Music, Sliders, SlidersHorizontal, Type } from 'lucide-react';
import { useEditorStore } from '@/lib/editor/store';
import { useI18n } from '@/lib/i18n/context';
import { cn } from '@/lib/utils/cn';
import { MediaPanel } from './media-panel';
import { TextPanel } from './text-panel';
import { AudioPanel } from './audio-panel';
import { EffectsPanel } from './effects-panel';
import { TransitionsPanel } from './transitions-panel';
import { PropertiesPanel } from './properties-panel';

type TabId = 'media' | 'text' | 'audio' | 'effects' | 'transitions' | 'properties';

const TABS: { id: TabId; icon: typeof Film; labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0] }[] = [
  { id: 'media', icon: Film, labelKey: 'editor.media' },
  { id: 'text', icon: Type, labelKey: 'editor.text' },
  { id: 'audio', icon: Music, labelKey: 'editor.audio' },
  { id: 'effects', icon: Sliders, labelKey: 'editor.effects' },
  { id: 'transitions', icon: Layers, labelKey: 'editor.transitions' },
  { id: 'properties', icon: SlidersHorizontal, labelKey: 'editor.properties' },
];

export function LeftPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('media');
  const selectionCount = useEditorStore((s) => s.selection.clipIds.length);
  const [previousCount, setPreviousCount] = useState(selectionCount);

  // Selecting a clip for the first time reveals its properties, which is what
  // people expect; after that the tab stays where they put it.
  if (selectionCount !== previousCount) {
    setPreviousCount(selectionCount);
    if (previousCount === 0 && selectionCount > 0) setTab('properties');
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <nav className="flex shrink-0 border-b border-line" role="tablist">
        {TABS.map(({ id, icon: Icon, labelKey }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            title={t(labelKey)}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1 py-2 text-[9.5px] transition-colors',
              tab === id ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            <Icon size={14} />
            <span className="truncate px-0.5">{t(labelKey)}</span>
            {tab === id && <span className="absolute inset-x-1.5 bottom-0 h-px bg-accent" />}
          </button>
        ))}
      </nav>

      {tab === 'media' && <MediaPanel userId={userId} />}
      {tab === 'text' && <TextPanel />}
      {tab === 'audio' && <AudioPanel />}
      {tab === 'effects' && <EffectsPanel />}
      {tab === 'transitions' && <TransitionsPanel />}
      {tab === 'properties' && <PropertiesPanel />}
    </aside>
  );
}
