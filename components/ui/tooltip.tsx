'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Small hover/focus tooltip. Deliberately dependency-free: the editor needs
 * hundreds of these and they must not cost anything at render time.
 */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const sideClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-sm',
            'border border-line bg-raised px-2 py-1 text-[11px] text-ink shadow-pop animate-fade-in',
            sideClass,
          )}
        >
          {label}
          {shortcut && (
            <kbd className="rounded-xs border border-line-strong bg-base px-1 py-px font-mono text-[10px] text-ink-muted">
              {shortcut}
            </kbd>
          )}
        </span>
      )}
    </span>
  );
}
