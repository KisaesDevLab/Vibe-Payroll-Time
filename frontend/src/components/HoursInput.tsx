// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  detectFormatKind,
  formatHours,
  parseHours,
  type ParseError,
  type TimeFormat,
} from '@vibept/shared';
import { useEffect, useRef, useState } from 'react';

export interface HoursInputProps {
  /** Controlled seconds value; null when cleared. */
  seconds: number | null;
  /** Emitted on every parseable keystroke with the parsed seconds, OR
   *  (null, errorCode) when the input is unparseable so the parent can
   *  surface the error. */
  onChange: (seconds: number | null, error: ParseError | null) => void;
  /** The user's current preferred format — controls the quick-increment
   *  button set. */
  format: TimeFormat;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

const ERROR_MESSAGES: Record<ParseError, string> = {
  EMPTY: 'Enter a duration',
  NEGATIVE: "Can't be negative",
  OVER_DAY: 'Over 24 hours — grids are one day per cell',
  BAD_COLON_FORMAT: 'Use H:MM, e.g. 5:48',
  BAD_MINUTES: 'Minutes must be 0–59',
  BAD_SECONDS: 'Seconds must be 0–59',
  MIXED: 'Pick one format — e.g. 5:48 or 5.8, not both',
  BAD_LABEL: 'Use h/hr/hrs and m/min/mins, e.g. 5h 48m',
  AMBIGUOUS: 'That\'s ambiguous — e.g. "5 48" could be 5:48 or 5.48',
  NOT_A_NUMBER: 'Not a number',
};

/**
 * Single input that accepts decimal, HH:MM, or labeled durations.
 * Every keystroke runs through `parseHours` so the parent learns about
 * failures in real time (good for live-hint UIs).
 */
export function HoursInput({
  seconds,
  onChange,
  format,
  autoFocus,
  placeholder,
  disabled,
}: HoursInputProps): JSX.Element {
  const [text, setText] = useState(() =>
    seconds == null ? '' : formatHours(seconds, format, { stripTrailingZeros: true }),
  );
  const [error, setError] = useState<ParseError | null>(null);
  const ref = useRef<HTMLInputElement | null>(null);

  // Re-sync text when the format toggle flips externally and our local
  // representation should swap decimal↔HH:MM.
  useEffect(() => {
    if (seconds != null) {
      setText(formatHours(seconds, format, { stripTrailingZeros: true }));
    }
  }, [format, seconds]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocus]);

  function handle(value: string) {
    setText(value);
    const result = parseHours(value);
    if ('error' in result) {
      setError(result.error);
      onChange(null, result.error);
    } else {
      setError(null);
      onChange(result.seconds, null);
    }
  }

  function addSeconds(delta: number) {
    const base = seconds ?? 0;
    const next = Math.max(0, base + delta);
    const asText = formatHours(next, format, { stripTrailingZeros: true });
    setText(asText);
    setError(null);
    onChange(next, null);
  }

  function setAbsolute(secondsValue: number) {
    const asText = formatHours(secondsValue, format, { stripTrailingZeros: true });
    setText(asText);
    setError(null);
    onChange(secondsValue, null);
  }

  const kind = detectFormatKind(text);
  const parsed = parseHours(text);
  const parsedSeconds = 'seconds' in parsed ? parsed.seconds : null;
  const otherFormat: TimeFormat = format === 'hhmm' ? 'decimal' : 'hhmm';

  const quickButtons =
    format === 'hhmm'
      ? [
          { label: '+0:15', action: () => addSeconds(15 * 60) },
          { label: '+0:30', action: () => addSeconds(30 * 60) },
          { label: '+1:00', action: () => addSeconds(3600) },
          { label: '8:00', action: () => setAbsolute(8 * 3600) },
        ]
      : [
          { label: '+0.25', action: () => addSeconds(15 * 60) },
          { label: '+0.50', action: () => addSeconds(30 * 60) },
          { label: '+1.00', action: () => addSeconds(3600) },
          { label: '8.00', action: () => setAbsolute(8 * 3600) },
        ];

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => handle(e.target.value)}
        placeholder={placeholder ?? 'type decimal or HH:MM'}
        disabled={disabled}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-lg font-mono shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
      />
      {/* Live parse-hint strip */}
      <div className="min-h-[1.5rem] text-xs">
        {error ? (
          <span className="text-red-600">{ERROR_MESSAGES[error]}</span>
        ) : parsedSeconds != null ? (
          <span className="text-slate-500">
            {text ? `"${text}"` : ''} → detected <b>{kind}</b> ·{' '}
            {formatHours(parsedSeconds, otherFormat)} = {parsedSeconds}s
          </span>
        ) : (
          <span className="text-slate-400">
            Accepted: 5.80 decimal · 5:48 HH:MM · 5h 48m labeled · 5.5 = 5:30
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {quickButtons.map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={disabled}
            onClick={b.action}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-60"
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setText('');
            setError('EMPTY');
            onChange(null, 'EMPTY');
          }}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-60"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
