'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/context';
import { createClient } from '@/lib/supabase/client';
import { AuthLink, AuthShell } from './auth-shell';

export function ForgotPasswordForm() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
      error={error}
      notice={sent ? t('auth.reset.sent') : null}
      footer={<AuthLink href="/login">{t('common.back')}</AuthLink>}
    >
      {!sent && (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('auth.email')}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            {t('auth.reset.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
