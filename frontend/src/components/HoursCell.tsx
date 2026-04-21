import { formatHoursDual, type TimeFormat } from '@vibept/shared';

export interface HoursCellProps {
  seconds: number;
  format: TimeFormat;
  sourceTag?: 'punched' | 'manual' | 'mixed' | 'none';
  locked?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Read-only dual-readout time display, click-to-edit when `onClick` is
 * provided. Renders nothing when seconds=0 except a light dash — the
 * grid fills empty cells with this.
 */
export function HoursCell({
  seconds,
  format,
  sourceTag = 'none',
  locked,
  onClick,
  className,
}: HoursCellProps): JSX.Element {
  const { primary, secondary } = formatHoursDual(seconds, format);
  const isZero = seconds === 0;

  const badgeColor = {
    punched: 'bg-slate-100 text-slate-600',
    manual: 'bg-amber-100 text-amber-700',
    mixed: 'bg-orange-100 text-orange-700',
    none: 'bg-transparent text-slate-400',
  }[sourceTag];

  const label = {
    punched: 'PUNCHED',
    manual: 'MANUAL',
    mixed: 'MIXED',
    none: '',
  }[sourceTag];

  const body = (
    <div className="flex flex-col items-end gap-0.5 text-right">
      {isZero ? (
        <span className="text-lg text-slate-300">—</span>
      ) : (
        <>
          <span className="text-lg font-semibold leading-none text-slate-900">{primary}</span>
          <span className="text-xs leading-none text-slate-500">{secondary}</span>
        </>
      )}
      <div className="mt-1 flex items-center gap-1 self-end">
        {label && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}>
            {label}
          </span>
        )}
        {locked && (
          <span
            title="In approved period"
            className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white"
          >
            ✓
          </span>
        )}
      </div>
    </div>
  );

  const base =
    'w-full px-2 py-2 rounded border transition focus:outline-none focus:ring-2 focus:ring-slate-400 ';
  const editable = onClick && !locked;
  const style = editable
    ? base + 'border-slate-200 bg-white hover:bg-slate-50 cursor-pointer'
    : base + 'border-transparent bg-transparent cursor-default';

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={style + ' ' + (className ?? '')}>
        {body}
      </button>
    );
  }
  return <div className={style + ' ' + (className ?? '')}>{body}</div>;
}
