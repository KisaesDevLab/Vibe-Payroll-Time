// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import type { EntryAuditRow } from '@vibept/shared';
import { Drawer } from './Drawer';
import { timesheets } from '../lib/resources';

export function EntryAuditDrawer({
  companyId,
  entryId,
  onClose,
}: {
  companyId: number;
  entryId: number;
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
              <AuditRow row={row} />
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}

function AuditRow({ row }: { row: EntryAuditRow }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + badgeClass(row.action)}>
          {row.action.replace('_', ' ')}
        </span>
        <span className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleString()}</span>
      </div>
      {row.field && (
        <p className="text-slate-700">
          <span className="font-medium">{row.field}</span>:{' '}
          <span className="font-mono text-xs">{formatValue(row.oldValue)}</span>{' '}
          <span className="text-slate-400">→</span>{' '}
          <span className="font-mono text-xs">{formatValue(row.newValue)}</span>
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

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
