// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useQuery } from '@tanstack/react-query';
import type { EntryAuditRow } from '@vibept/shared';
import { Drawer } from './Drawer';
import { timesheets } from '../lib/resources';

export function EntryAuditDrawer({
  companyId,
  entryId,
  timezone,
  onClose,
}: {
  companyId: number;
  entryId: number;
  /** Company timezone: when changes happened and the times they set are
   *  shown in it, like the timesheet. Browser zone if omitted. */
  timezone?: string;
  onClose: () => void;
}) {
  const audit = useQuery({
    queryKey: ['entry-audit', companyId, entryId],
    queryFn: () => timesheets.audit(companyId, entryId),
  });

  return (
    <Drawer open onClose={onClose} title={`Entry #${entryId} history`}>
      {audit.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {audit.isError && <p className="text-sm text-red-700">Could not load audit trail.</p>}
      {audit.data && audit.data.length === 0 && (
        <p className="text-sm text-slate-500">No audit rows.</p>
      )}
      {audit.data && audit.data.length > 0 && (
        <ol className="relative ml-2 border-l border-slate-200 pl-5">
          {audit.data.map((row) => (
            <li key={row.id} className="mb-5">
              <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full border border-white bg-slate-900" />
              <AuditRow row={row} timezone={timezone} />
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}

function AuditRow({ row, timezone }: { row: EntryAuditRow; timezone?: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + badgeClass(row.action)}>
          {row.action.replace('_', ' ')}
        </span>
        <span className="text-xs text-slate-500">{formatInstant(row.createdAt, timezone)}</span>
      </div>
      {row.field && (
        <p className="text-slate-700">
          <span className="font-medium">{row.field}</span>:{' '}
          <span className="font-mono text-xs">{formatValue(row.oldValue, timezone)}</span>{' '}
          <span className="text-slate-400">→</span>{' '}
          <span className="font-mono text-xs">{formatValue(row.newValue, timezone)}</span>
        </p>
      )}
      {row.reason && (
        <p className="text-xs text-slate-600">
          <span className="font-medium">Reason:</span> {row.reason}
        </p>
      )}
      <p className="text-xs text-slate-500">
        by {row.actorEmail ?? <em className="italic">system</em>}
      </p>
    </div>
  );
}

function badgeClass(action: EntryAuditRow['action']): string {
  switch (action) {
    case 'create':
      return 'bg-blue-100 text-blue-800';
    case 'edit':
      return 'bg-amber-100 text-amber-800';
    case 'approve':
      return 'bg-emerald-100 text-emerald-800';
    case 'unapprove':
      return 'bg-slate-200 text-slate-800';
    case 'delete':
    case 'manual_delete':
      return 'bg-red-100 text-red-800';
    case 'auto_close':
      return 'bg-purple-100 text-purple-800';
    case 'manual_create':
    case 'manual_update':
    case 'manual_override':
    case 'manual_revert':
      return 'bg-orange-100 text-orange-800';
  }
}

function formatInstant(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function formatValue(v: unknown, timezone?: string): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  // Timestamps (started_at / ended_at changes) read as company-zone times.
  if (typeof v === 'string' && ISO_INSTANT.test(v)) return formatInstant(v, timezone);
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
