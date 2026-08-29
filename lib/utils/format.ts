import type { Locale } from '@/lib/i18n/dictionaries';

/** "2 hours ago" / "for 2 timer siden", without pulling in a date library. */
export function relativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const rtf = new Intl.RelativeTimeFormat(locale === 'nb' ? 'nb-NO' : 'en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600e3],
    ['month', 30 * 24 * 3600e3],
    ['week', 7 * 24 * 3600e3],
    ['day', 24 * 3600e3],
    ['hour', 3600e3],
    ['minute', 60e3],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return rtf.format(-Math.round(diff / 1000), 'second');
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'nb' ? 'nb-NO' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** "1t 05m" style clock length for project cards. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatCountdown(target: string | null, locale: Locale): string {
  if (!target) return '—';
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return locale === 'nb' ? 'straks' : 'any moment';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return locale === 'nb' ? `${minutes} min` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return locale === 'nb' ? `${hours} t ${rest} min` : `${hours} h ${rest} min`;
}
