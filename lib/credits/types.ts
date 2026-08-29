export interface CreditStatus {
  balance: number;
  unlimited: boolean;
  refillAmount: number;
  refillIntervalSeconds: number;
  nextRefillAt: string | null;
  lifetimeSpent: number;
  costs: Record<string, number>;
}

export const DEFAULT_CREDIT_STATUS: CreditStatus = {
  balance: 0,
  unlimited: false,
  refillAmount: 1000,
  refillIntervalSeconds: 8 * 3600,
  nextRefillAt: null,
  lifetimeSpent: 0,
  costs: {},
};

export function parseCreditStatus(value: unknown): CreditStatus {
  if (!value || typeof value !== 'object') return DEFAULT_CREDIT_STATUS;
  const raw = value as Record<string, unknown>;
  return {
    balance: Number(raw.balance ?? 0),
    unlimited: Boolean(raw.unlimited),
    refillAmount: Number(raw.refillAmount ?? 1000),
    refillIntervalSeconds: Number(raw.refillIntervalSeconds ?? 8 * 3600),
    nextRefillAt: typeof raw.nextRefillAt === 'string' ? raw.nextRefillAt : null,
    lifetimeSpent: Number(raw.lifetimeSpent ?? 0),
    costs: (raw.costs as Record<string, number>) ?? {},
  };
}
