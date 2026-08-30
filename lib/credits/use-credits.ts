'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_CREDIT_STATUS, parseCreditStatus, type CreditStatus } from './types';

/**
 * Reads the signed-in user's credit wallet. The refill is lazy and happens
 * inside get_credit_status(), so simply reading it keeps the balance current.
 */
export function useCredits(pollMs = 60_000) {
  const [status, setStatus] = useState<CreditStatus>(DEFAULT_CREDIT_STATUS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_credit_status');
    if (!error) setStatus(parseCreditStatus(data));
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Inlined so every setState lands after an await, never during the effect.
    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_credit_status');
      if (cancelled) return;
      if (!error) setStatus(parseCreditStatus(data));
      setLoading(false);
    };
    void load().catch(() => undefined);
    if (!pollMs) return () => {
      cancelled = true;
    };
    const id = window.setInterval(() => void load().catch(() => undefined), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return { status, loading, refresh };
}
