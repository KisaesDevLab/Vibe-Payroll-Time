// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/** 0 = Sunday .. 6 = Saturday, matching `work_days` storage. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function workDaysLabel(days: number[]): string {
  if (days.length === 0) return 'None';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(',') === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.length === 7) return 'Every day';
  return sorted.map((d) => DAYS[d]).join(', ');
}

/** Seven toggle chips; `value` is the selected weekday numbers. */
export function WorkDaysPicker({
  value,
  onChange,
  disabled = false,
  label = 'Work days',
}: {
  value: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
  label?: string;
}): JSX.Element {
  const selected = new Set(value);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {DAYS.map((name, day) => {
        const on = selected.has(day);
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(day);
              else next.add(day);
              onChange([...next].sort((a, b) => a - b));
            }}
            className={
              'w-12 rounded-md border px-2 py-1.5 text-sm font-medium transition disabled:opacity-50 ' +
              (on
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
            }
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
