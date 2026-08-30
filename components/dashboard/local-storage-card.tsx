'use client';

import { useEffect, useState } from 'react';
import { HardDrive, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { formatBytes } from '@/lib/utils/format';
import { localStorageUsage, requestPersistence, type StorageUsage } from '@/lib/media/local-store';
import { Button } from '@/components/ui/button';

/**
 * How much of this machine the app is using.
 *
 * With media stored locally the honest number is not "your Supabase quota" but
 * the browser's own allowance, and whether it has promised to keep the files.
 */
export function LocalStorageCard() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await localStorageUsage();
      if (!cancelled) setUsage(result);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [asking]);

  if (!usage || usage.quota === 0) return null;
  const percent = Math.min(100, Math.round((usage.used / usage.quota) * 100));

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-1 flex items-center gap-2 text-[13px] font-medium text-ink">
        <HardDrive size={14} /> {t('editor.storedLocally')}
      </h2>
      <p className="text-[12.5px] text-ink-muted">
        {t('editor.storageUsed', { used: formatBytes(usage.used), quota: formatBytes(usage.quota) })}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      {usage.persistent ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-positive">
          <ShieldCheck size={12} /> {t('settings.storagePersistent')}
        </p>
      ) : (
        <div className="mt-2">
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-warning">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {t('editor.storageAtRisk')}
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            loading={asking}
            onClick={async () => {
              setAsking(true);
              await requestPersistence();
              setAsking(false);
            }}
          >
            {t('settings.storageProtect')}
          </Button>
        </div>
      )}
    </section>
  );
}
