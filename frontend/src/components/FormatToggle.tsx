// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { TimeFormat } from '@vibept/shared';

export interface FormatToggleProps {
  value: TimeFormat;
  onChange: (next: TimeFormat) => void;
  disabled?: boolean;
  /** Compact mode for toolbar placement. */
  size?: 'default' | 'sm';
}

/**
 * Two-segment pill that flips between decimal and HH:MM. Parent owns
 * persistence — typically this fires an async save to
 * `/me/preferences` debounced by the parent, or pushes directly into
 * a React Query mutation.
 */
export function FormatToggle({
  value,
  onChange,
  disabled,
  size = 'default',
}: FormatToggleProps): JSX.Element {
  const buttonBase =
    size === 'sm'
      ? 'px-2 py-1 text-xs uppercase tracking-wider'
      : 'px-3 py-1.5 text-sm uppercase tracking-wider';
  const active = 'bg-slate-900 text-white shadow';
  const inactive = 'bg-transparent text-slate-600 hover:bg-slate-200';

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-slate-300 bg-slate-100 p-0.5"
      role="group"
      aria-label="Time format"
    >
      <button
        type="button"
        onClick={() => value !== 'decimal' && onChange('decimal')}
        disabled={disabled}
        className={
          'rounded-full transition ' +
          buttonBase +
          ' ' +
          (value === 'decimal' ? active : inactive) +
          ' disabled:opacity-60'
        }
      >
        Decimal
      </button>
      <button
        type="button"
        onClick={() => value !== 'hhmm' && onChange('hhmm')}
        disabled={disabled}
        className={
          'rounded-full transition ' +
          buttonBase +
          ' ' +
          (value === 'hhmm' ? active : inactive) +
          ' disabled:opacity-60'
        }
      >
        HH:MM
      </button>
    </div>
  );
}
