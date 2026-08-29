import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { cookies } from 'next/headers';
import { I18nProvider } from '@/lib/i18n/context';
import { LOCALE_COOKIE, isLocale, type Locale } from '@/lib/i18n/dictionaries';
import { createServerSupabase } from '@/lib/supabase/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VideoAI', template: '%s · VideoAI' },
  description: 'A professional video editor that an AI assistant can drive end to end.',
  applicationName: 'VideoAI',
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  width: 'device-width',
  initialScale: 1,
};

async function resolveLocale(): Promise<Locale> {
  // A locale picked in the UI is stored in a cookie, so the very first render
  // is already in the right language.
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return 'en';
    const { data: profile } = await supabase
      .from('profiles')
      .select('locale')
      .eq('user_id', data.user.id)
      .maybeSingle();
    return isLocale(profile?.locale) ? profile.locale : 'en';
  } catch {
    // Missing env vars during a first build should not break rendering.
    return 'en';
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
