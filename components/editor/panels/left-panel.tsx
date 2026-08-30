'use client';

import { useState } from 'react';
import { AudioLines, Film, Layers, Music, Smile, Sparkles, Type } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { cn } from '@/lib/utils/cn';
import { MediaPanel } from './media-panel';
import { TextPanel } from './text-panel';
import { AudioPanel } from './audio-panel';
import { EffectsPanel } from './effects-panel';
import { TransitionsPanel } from './transitions-panel';
import { SoundsPanel } from './sounds-panel';
import { StickersPanel } from './stickers-panel';

type TabId = 'media' | 'text' | 'sounds' | 'stickers' | 'audio' | 'effects' | 'transitions';

const TABS: { id: TabId; icon: typeof Film; labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0] }[] = [
  { id: 'media', icon: Film, labelKey: 'editor.media' },
  { id: 'text', icon: Type, labelKey: 'editor.text' },
  { id: 'sounds', icon: Music, labelKey: 'editor.sounds' },
  { id: 'stickers', icon: Smile, labelKey: 'editor.stickersShort' },
  { id: 'audio', icon: AudioLines, labelKey: 'editor.audio' },
  { id: 'effects', icon: Sparkles, labelKey: 'editor.effects' },
  { id: 'transitions', icon: Layers, labelKey: 'editor.transitionsShort' },
];

/**
 * The library side of the editor: a vertical icon rail, CapCut style, with the
 * chosen library beside it. The inspector lives on the right, next to the
 * assistant, so a selected clip and the chat are visible at the same time.
 */
export function LeftPanel({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>('media');

  return (
    <aside className="flex shrink-0 border-r border-line bg-surface">
      <nav className="flex w-[68px] shrink-0 flex-col gap-0.5 border-r border-line py-2" role="tablist">
        {TABS.map(({ id, icon: Icon, labelKey }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            title={t(labelKey)}
            className={cn(
              'relative mx-1 flex flex-col items-center gap-1 rounded-md py-2 text-[9px] transition-colors',
              tab === id ? 'bg-elevated text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            <Icon size={15} />
            <span className="w-full truncate px-0.5 text-center">{t(labelKey)}</span>
            {tab === id && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      <div className="flex w-[292px] min-w-0 flex-col">
        {tab === 'media' && <MediaPanel userId={userId} />}
        {tab === 'text' && <TextPanel />}
        {tab === 'sounds' && <SoundsPanel />}
        {tab === 'stickers' && <StickersPanel />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'effects' && <EffectsPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
      </div>
    </aside>
  );
}
