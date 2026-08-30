'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Views } from '@/types/database';
import { useI18n } from '@/lib/i18n/context';
import { setUserAdminAction, setUserCreditsAction } from '@/lib/actions/admin';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ToggleControl } from '@/components/editor/panels/controls';

export function UserEditor({
  user,
  currentUserId,
  onClose,
}: {
  user: Views<'admin_users'> | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [balance, setBalance] = useState(String(user?.credits ?? 0));
  const [unlimited, setUnlimited] = useState(Boolean(user?.credits_unlimited));
  const [refillAmount, setRefillAmount] = useState(String(user?.refill_amount ?? 1000));
  const [refillHours, setRefillHours] = useState('8');
  const [isAdmin, setIsAdmin] = useState(Boolean(user?.is_admin));

  if (!user) return null;
  const self = user.user_id === currentUserId;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const credits = await setUserCreditsAction({
        userId: user.user_id as string,
        balance: Number(balance),
        unlimited,
        refillAmount: Number(refillAmount),
        refillHours: Number(refillHours),
      });
      if (!credits.ok) {
        setError(credits.error ?? t('error.generic'));
        return;
      }
      if (!self && isAdmin !== Boolean(user.is_admin)) {
        const admin = await setUserAdminAction(user.user_id as string, isAdmin);
        if (!admin.ok) {
          setError(admin.error ?? t('error.generic'));
          return;
        }
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('admin.edit.title', { name: user.username ?? user.email ?? '' })}
      description={user.email ?? undefined}
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} loading={pending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.edit.balance')}>
            <Input
              type="number"
              min={0}
              value={balance}
              disabled={unlimited}
              onChange={(e) => setBalance(e.target.value)}
            />
          </Field>
          <Field label={t('admin.edit.refillAmount')}>
            <Input type="number" min={0} value={refillAmount} onChange={(e) => setRefillAmount(e.target.value)} />
          </Field>
        </div>

        <Field label={t('admin.edit.refillHours')}>
          <Input type="number" min={1} max={720} value={refillHours} onChange={(e) => setRefillHours(e.target.value)} />
        </Field>

        <div className="space-y-2.5 rounded-md border border-line bg-base px-3 py-2.5">
          <ToggleControl label={t('admin.edit.unlimited')} checked={unlimited} onChange={setUnlimited} />
          <ToggleControl
            label={t('admin.edit.isAdmin')}
            checked={isAdmin}
            onChange={(next) => !self && setIsAdmin(next)}
          />
          {self && <p className="text-[11.5px] text-ink-faint">{t('admin.edit.self')}</p>}
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
        )}
      </div>
    </Modal>
  );
}
