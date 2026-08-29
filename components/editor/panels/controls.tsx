'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils/cn';

export function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-3 py-3 last:border-b-0">
      <header className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[10.5px] font-medium tracking-wider text-ink-faint uppercase">{title}</h3>
        {action}
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[11.5px] text-ink-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A slider that commits on release. Dragging updates the preview locally while
 * only the final value becomes an undoable editor command.
 */
export function SliderControl({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onPreview,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onPreview?: (value: number) => void;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  const [lastExternal, setLastExternal] = useState(value);

  // Adjust state during render rather than in an effect: this is the pattern
  // React recommends for "prop changed, reset derived state".
  if (!dragging && value !== lastExternal) {
    setLastExternal(value);
    setLocal(value);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-ink-muted">{label}</span>
        <span className="font-mono text-[11px] text-ink tabular-nums">
          {format ? format(local) : local.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          setLocal(next);
          onPreview?.(next);
        }}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => {
          setDragging(false);
          onCommit(local);
        }}
        onKeyUp={() => onCommit(local)}
        className="w-full"
      />
    </div>
  );
}

export function NumberControl({
  label,
  value,
  step = 0.1,
  min,
  max,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const [lastExternal, setLastExternal] = useState(value);
  if (value !== lastExternal) {
    setLastExternal(value);
    setLocal(String(Math.round(value * 1000) / 1000));
  }

  const commit = () => {
    const parsed = Number(local);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setLocal(String(value));
  };

  return (
    <Row label={label}>
      <div className="relative">
        <input
          type="number"
          value={local}
          step={step}
          min={min}
          max={max}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="h-7 w-full rounded-sm border border-line bg-base px-2 text-[12px] text-ink tabular-nums transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 text-[10.5px] text-ink-faint">
            {suffix}
          </span>
        )}
      </div>
    </Row>
  );
}

export function ColorControl({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value.startsWith('#') ? value : '#ffffff'}
          onChange={(e) => onCommit(e.target.value)}
          className="h-7 w-9 rounded-sm"
        />
        <input
          value={value}
          onChange={(e) => onCommit(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-base px-2 font-mono text-[11px] text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
        />
      </div>
    </Row>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
}) {
  const control = (
    <div className="flex gap-0.5 rounded-sm bg-base p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1 rounded-xs px-1.5 py-1 text-[11px] transition-colors',
            value === option.value ? 'bg-raised text-ink' : 'text-ink-faint hover:text-ink-muted',
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
  return label ? <Row label={label}>{control}</Row> : control;
}

export function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="text-[11.5px] text-ink-muted">{label}</span>
      <span
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </label>
  );
}
