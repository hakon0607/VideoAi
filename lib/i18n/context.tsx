'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_COOKIE, translate, type DictionaryKey, type Locale } from './dictionaries';

interface I18nValue {
  locale: Locale;
  t: (key: DictionaryKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);


export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // Stored in a cookie rather than localStorage so the server renders the
    // right language on the very first paint — no flash of English.
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Ignore; the choice simply will not persist on this device.
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>.');
  return ctx;
}

export function useT() {
  return useI18n().t;
}
