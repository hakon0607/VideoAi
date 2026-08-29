'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/context';
import { createClient } from '@/lib/supabase/client';
import { AuthShell } from './auth-shell';

export function ResetPasswordForm() {
  const t = useT();
  const router = useRouter();
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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <AuthShell title={t('auth.newPassword.title')} subtitle={t('auth.reset.subtitle')} error={error}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('auth.password')}>
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
          {t('auth.newPassword.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
