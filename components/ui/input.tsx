'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border border-line bg-base px-3 text-[13px] text-ink',
          'placeholder:text-ink-faint transition-colors',
          'hover:border-line-strong focus:border-accent focus:outline-none',
          'disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none rounded-md border border-line bg-base px-3 py-2 text-[13px] text-ink',
          'placeholder:text-ink-faint transition-colors',
          'hover:border-line-strong focus:border-accent focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-line bg-base px-3 pr-8 text-[13px] text-ink',
          'transition-colors hover:border-line-strong focus:border-accent focus:outline-none',
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2399a0ad%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}
