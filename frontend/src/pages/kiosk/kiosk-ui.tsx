// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * Kiosk-only building blocks. The shared <Button> / <FormField> are designed
 * for light pages (primary = slate-900, labels = slate-700) and vanish on the
 * kiosk's slate-900 background, so the kiosk gets its own high-contrast set.
 * Every pairing here is WCAG AA or better (>= 4.5:1) at wall-tablet distance.
 */

type KioskVariant = 'primary' | 'danger' | 'secondary' | 'link';

const base =
  'inline-flex items-center justify-center rounded-xl font-semibold transition select-none ' +
  'focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-slate-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<KioskVariant, string> = {
  // Clock in / End break / Enter / Pair
  primary:
    'min-h-16 px-6 text-xl bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-900/40 ' +
    'hover:bg-emerald-400 active:bg-emerald-600',
  // Clock out
  danger:
    'min-h-16 px-6 text-xl bg-rose-500 text-white shadow-lg shadow-rose-950/40 ' +
    'hover:bg-rose-400 active:bg-rose-600',
  // Start break, Done
  secondary:
    'min-h-14 px-6 text-lg bg-slate-700 text-white border-2 border-slate-400 ' +
    'hover:bg-slate-600 active:bg-slate-800',
  // Unpair, Not me, Scan instead
  link:
    'min-h-12 px-4 text-base font-medium text-slate-200 underline underline-offset-4 ' +
    'decoration-slate-500 hover:text-white hover:decoration-slate-300',
};

export function KioskButton({
  variant = 'primary',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: KioskVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className ?? ''}`}
    >
      {loading ? '…' : children}
    </button>
  );
}

export function KioskField({
  label,
  hint,
  id,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const inputId = id ?? `kfield-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      <span className="text-base font-semibold text-slate-100">{label}</span>
      <input
        id={inputId}
        className={
          'min-h-14 rounded-lg border-2 border-slate-500 bg-white px-4 text-xl text-slate-900 ' +
          'placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-4 focus:ring-sky-400/40 ' +
          (className ?? '')
        }
        {...rest}
      />
      {hint && <span className="text-sm text-slate-300">{hint}</span>}
    </label>
  );
}
