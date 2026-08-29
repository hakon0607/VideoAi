'use client';

import { useState } from 'react';
import { Coins, Infinity as InfinityIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { useCredits } from '@/lib/credits/use-credits';
import { formatCountdown } from '@/lib/utils/format';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';

const COST_LABEL_KEYS = {
  ai_command: 'credits.cost.ai_command',
  ai_question: 'credits.cost.ai_question',
  transcription: 'credits.cost.transcription',
  export: 'credits.cost.export',
} as const;

export function CreditBadge({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const { status, loading } = useCredits();
  const [open, setOpen] = useState(false);

  const low = !status.unlimited && status.balance < 250;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
          compact ? 'h-7' : 'h-8',
          low
            ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15'
            : 'border-line bg-elevated text-ink-muted hover:text-ink',
        )}
        title={t('credits.title')}
      >
        {status.unlimited ? <InfinityIcon size={13} /> : <Coins size={13} />}
        {loading ? '—' : status.unlimited ? t('credits.unlimited') : status.balance.toLocaleString(locale)}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('credits.title')} width="sm">
        <div className="space-y-4">
          <div className="rounded-md border border-line bg-base px-4 py-3.5">
            <div className="text-[26px] font-semibold tabular-nums text-ink">
              {status.unlimited ? t('credits.unlimited') : status.balance.toLocaleString(locale)}
            </div>
            {!status.unlimited && (
              <p className="mt-1 text-[12.5px] text-ink-muted">
                {status.nextRefillAt
                  ? t('credits.refillIn', { time: formatCountdown(status.nextRefillAt, locale) })
                  : t('credits.refillNow')}
              </p>
            )}
          </div>

          {!status.unlimited && (
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {t('credits.empty.body', {
                amount: status.refillAmount.toLocaleString(locale),
                hours: Math.round(status.refillIntervalSeconds / 3600),
                time: formatCountdown(status.nextRefillAt, locale),
              })}
            </p>
          )}

          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              {t('credits.priceList')}
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
              {Object.entries(status.costs).map(([key, cost]) => (
                <li key={key} className="flex items-center justify-between bg-base px-3 py-2 text-[12.5px]">
                  <span className="text-ink-muted">
                    {key in COST_LABEL_KEYS ? t(COST_LABEL_KEYS[key as keyof typeof COST_LABEL_KEYS]) : key}
                  </span>
                  <span className="tabular-nums text-ink">{cost === 0 ? '—' : cost}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[12px] text-ink-faint">{t('credits.spent', { amount: status.lifetimeSpent.toLocaleString(locale) })}</p>
        </div>
      </Modal>
    </>
  );
}
