// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { formatHours, type CorrectionRequest, type TimeFormat } from '@vibept/shared';
import { formatClock } from './company-time';

/** "Mon, Nov 9 · 8:00 AM" for an instant, in the company's timezone. */
export function formatDayTime(iso: string, tz: string | undefined): string {
  const day = new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
  return `${day} · ${formatClock(iso, tz)}`;
}

/**
 * One line saying what a correction request asks for, with every time in
 * the company's timezone:
 *  - add:    "Add shift: Mon, Nov 9 · 8:00 AM → 4:30 PM (8.5 hrs)"
 *  - edit:   "Change entry #12: start → Mon, Nov 9 · 8:00 AM; end → …"
 *  - delete: "Remove entry #12"
 */
export function describeCorrection(
  r: Pick<CorrectionRequest, 'requestType' | 'timeEntryId' | 'proposedChanges'>,
  tz: string | undefined,
  format: TimeFormat,
): string {
  const c = r.proposedChanges as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const startedAt = str(c.startedAt);
  const endedAt = str(c.endedAt);
  const entry = r.timeEntryId != null ? `entry #${r.timeEntryId}` : 'entry';

  if (r.requestType === 'delete') return `Remove ${entry}`;

  if (r.requestType === 'add') {
    if (!startedAt || !endedAt) return 'Add shift';
    const seconds = Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    );
    return `Add shift: ${formatDayTime(startedAt, tz)} → ${formatClock(endedAt, tz)} (${formatHours(seconds, format)} hrs)`;
  }

  const parts: string[] = [];
  if (startedAt) parts.push(`start → ${formatDayTime(startedAt, tz)}`);
  if ('endedAt' in c) parts.push(`end → ${endedAt ? formatDayTime(endedAt, tz) : 'open'}`);
  if ('jobId' in c) parts.push(c.jobId == null ? 'no job' : `job #${String(c.jobId)}`);
  if (typeof c.entryType === 'string') parts.push(`type → ${c.entryType}`);
  return `Change ${entry}${parts.length ? `: ${parts.join('; ')}` : ''}`;
}
