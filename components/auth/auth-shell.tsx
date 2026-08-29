'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  error,
  notice,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  error?: string | null;
  notice?: string | null;
}) {
  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">{subtitle}</p>

      {notice && (
        <p className="mt-5 rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-danger"
        >
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">{children}</div>
      {footer && <div className="mt-6 text-[13px] text-ink-muted">{footer}</div>}
    </div>
  );
}

export function AuthLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('text-accent transition-colors hover:text-accent-hover', className)}>
      {children}
    </Link>
  );
}
