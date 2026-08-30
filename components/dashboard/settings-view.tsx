'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Infinity as InfinityIcon, Shield } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { LOCALES, LOCALE_LABELS, isLocale } from '@/lib/i18n/dictionaries';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { updateProfileAction } from '@/lib/actions/profile';
import { useCredits } from '@/lib/credits/use-credits';
import { formatCountdown } from '@/lib/utils/format';

export function SettingsView({
  email,
  username: initialUsername,
  displayName: initialDisplayName,
  locale: initialLocale,
  isAdmin = false,
}: {
  email: string;
  username: string;
  displayName: string;
  locale: string;
  isAdmin?: boolean;
}) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const { status } = useCredits(0);
  const [username, setUsername] = useState(initialUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [formLocale, setFormLocale] = useState(initialLocale);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfileAction({ username, displayName, locale: formLocale });
      if (!result.ok) {
        setError(result.error ?? t('error.generic'));
        return;
      }
      if (isLocale(formLocale)) setLocale(formLocale);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{t('settings.title')}</h1>
        {isAdmin && (
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <Shield size={11} /> {t('admin.title')}
          </Link>
        )}
      </div>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-4 text-[13px] font-medium text-ink">{t('settings.account')}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('auth.email')}>
            <Input value={email} disabled readOnly />
          </Field>
          <Field label={t('settings.username')} error={error}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label={t('settings.displayName')}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label={t('settings.language')}>
            <Select value={formLocale} onChange={(e) => setFormLocale(e.target.value)}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="primary" loading={pending}>
              {t('settings.saveProfile')}
            </Button>
            {saved && <span className="text-[12.5px] text-positive">{t('settings.profileSaved')}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-3 text-[13px] font-medium text-ink">{t('credits.title')}</h2>
        <p
          className={`flex items-center gap-2 text-[24px] font-semibold tabular-nums ${
            status.unlimited ? 'text-accent' : 'text-ink'
          }`}
        >
          {status.unlimited && <InfinityIcon size={20} />}
          {status.unlimited ? t('credits.unlimited') : status.balance.toLocaleString(locale)}
        </p>
        {status.unlimited && <p className="mt-1 text-[12.5px] text-ink-muted">{t('credits.unlimitedHint')}</p>}
        {!status.unlimited && (
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {t('credits.empty.body', {
              amount: status.refillAmount.toLocaleString(locale),
              hours: Math.round(status.refillIntervalSeconds / 3600),
              time: formatCountdown(status.nextRefillAt, locale),
            })}
          </p>
        )}
      </section>
    </div>
  );
}
