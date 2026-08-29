'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/context';
import { createClient } from '@/lib/supabase/client';
import { AuthLink, AuthShell } from './auth-shell';

export function LoginForm({ nextPath, notice }: { nextPath: string; notice: string | null }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    router.push(nextPath.startsWith('/') ? nextPath : '/dashboard');
    router.refresh();
  }

  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      error={error}
      notice={notice}
      footer={
        <>
          {t('auth.login.noAccount')} <AuthLink href="/signup">{t('auth.signup.submit')}</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
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
        <Field label={t('auth.password')}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <AuthLink href="/forgot-password" className="text-[12.5px]">
        {t('auth.forgot')}
      </AuthLink>
    </AuthShell>
  );
}
