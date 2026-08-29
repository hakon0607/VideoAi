'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings as SettingsIcon, User as UserIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { LOCALE_LABELS, LOCALES } from '@/lib/i18n/dictionaries';

export function ProfileMenu({
  displayName,
  username,
  email,
}: {
  displayName: string;
  username: string;
  email: string;
}) {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = (displayName || username || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-full border border-line bg-elevated text-[11px] font-semibold text-ink transition-colors hover:border-line-strong"
      >
        {initials || <UserIcon size={14} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-pop animate-fade-in"
        >
          <div className="border-b border-line px-3.5 py-3">
            <p className="truncate text-[13px] font-medium text-ink">{displayName || username}</p>
            <p className="truncate text-[12px] text-ink-faint">{email}</p>
          </div>

          <div className="p-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <UserIcon size={14} /> {t('common.profile')}
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <SettingsIcon size={14} /> {t('common.settings')}
            </Link>
          </div>

          <div className="border-t border-line px-3.5 py-2.5">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              {t('common.language')}
            </p>
            <div className="flex gap-1">
              {LOCALES.map((code) => (
                <button
                  key={code}
                  onClick={() => setLocale(code)}
                  className={`flex-1 rounded-sm px-2 py-1 text-[12px] transition-colors ${
                    locale === code ? 'bg-accent text-white' : 'bg-elevated text-ink-muted hover:text-ink'
                  }`}
                >
                  {LOCALE_LABELS[code]}
                </button>
              ))}
            </div>
          </div>

          <form action="/auth/signout" method="post" className="border-t border-line p-1">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] text-ink-muted transition-colors hover:bg-elevated hover:text-danger"
            >
              <LogOut size={14} /> {t('common.logout')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
