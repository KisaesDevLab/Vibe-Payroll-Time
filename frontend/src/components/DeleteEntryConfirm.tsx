import { useState } from 'react';
import type { TimeEntry } from '@vibept/shared';

/**
 * Soft-delete confirmation. Requires a reason the supervisor will be
 * on the hook for — shows up in the audit trail forever.
 */
export function DeleteEntryConfirm({
  entry,
  employeeName,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  entry: TimeEntry;
  employeeName: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [reason, setReason] = useState('');

  const fmt = (iso: string | null) => {
    if (!iso) return 'open';
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (reason.trim().length > 0) onConfirm(reason.trim());
        }}
      >
        <h3 className="text-base font-semibold text-slate-900">Delete {entry.entryType} entry?</h3>
        <p className="mt-1 text-sm text-slate-600">
          {employeeName}: {fmt(entry.startedAt)} → {fmt(entry.endedAt)}
        </p>
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          Soft-delete — the row stays in the audit trail, but totals stop counting it. You can't
          undo from the UI; a SuperAdmin can restore it from the DB.
        </p>

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-700">
            Reason <span className="text-red-600">*</span>
          </span>
          <textarea
            required
            rows={2}
            maxLength={500}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
            placeholder="e.g. Duplicate — employee also punched in on kiosk"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={reason.trim().length === 0 || pending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? 'Deleting…' : 'Delete entry'}
          </button>
        </div>
      </form>
    </div>
  );
}
