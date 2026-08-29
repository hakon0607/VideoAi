'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useI18n } from '@/lib/i18n/context';
import { createClient } from '@/lib/supabase/client';
import { AuthLink, AuthShell } from './auth-shell';

export function SignupForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0], locale },
        emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    // With email confirmation on, there is no session yet.
    if (!data.session) {
      router.push(`/login?message=${encodeURIComponent(t('auth.confirmEmail'))}`);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <AuthShell
      title={t('auth.signup.title')}
      subtitle={t('auth.signup.subtitle')}
      error={error}
      footer={
        <>
          {t('auth.signup.hasAccount')} <AuthLink href="/login">{t('auth.login.submit')}</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('auth.displayName')}>
          <Input
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </Field>
        <Field label={t('auth.email')}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label={t('auth.password')} hint="Minimum 8 characters">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {t('auth.signup.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
