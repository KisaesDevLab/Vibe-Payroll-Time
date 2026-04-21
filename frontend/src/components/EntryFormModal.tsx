import type { Job, TimeEntry } from '@vibept/shared';
import { useMemo, useState } from 'react';

/**
 * Shared form modal for both creating new entries (missed-punch flow)
 * and editing existing ones. In "create" mode employeeId is required;
 * in "edit" mode the existing entry is supplied and the employeeId is
 * implied.
 *
 * Every submission requires a reason — the audit trail depends on it
 * (CLAUDE.md: "Every edit to a time_entry writes a time_entry_audit
 * row (who, when, field, old, new, reason). Non-negotiable.").
 */

export type EntryFormMode =
  | { mode: 'create'; employeeName: string; employeeId: number }
  | { mode: 'edit'; entry: TimeEntry; employeeName: string };

export interface EntryFormValues {
  startedAt: string; // ISO
  endedAt: string | null; // ISO (edit mode can keep null for open); create mode must be set
  entryType: 'work' | 'break';
  jobId: number | null;
  reason: string;
}

interface Props {
  target: EntryFormMode;
  jobs: Job[];
  onCancel: () => void;
  onSubmit: (values: EntryFormValues) => void;
  pending: boolean;
  error?: string | null;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // HTML datetime-local uses local time, format YYYY-MM-DDTHH:mm.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function EntryFormModal({ target, jobs, onCancel, onSubmit, pending, error }: Props) {
  const initial = useMemo<EntryFormValues>(() => {
    if (target.mode === 'edit') {
      return {
        startedAt: target.entry.startedAt,
        endedAt: target.entry.endedAt,
        entryType: target.entry.entryType,
        jobId: target.entry.jobId,
        reason: '',
      };
    }
    // Create mode defaults to a two-hour window ending now in local tz.
    const end = new Date();
    const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
    return {
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      entryType: 'work',
      jobId: null,
      reason: '',
    };
  }, [target]);

  const [values, setValues] = useState<EntryFormValues>(initial);

  const isCreate = target.mode === 'create';
  const canSubmit =
    values.reason.trim().length >= 1 &&
    values.startedAt.length > 0 &&
    (isCreate ? !!values.endedAt : true) &&
    // Enforce end > start whenever endedAt is set.
    (!values.endedAt || new Date(values.endedAt) > new Date(values.startedAt));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (canSubmit) onSubmit(values);
        }}
      >
        <h3 className="text-base font-semibold text-slate-900">
          {isCreate
            ? `Add entry for ${target.employeeName}`
            : `Edit entry — ${target.employeeName}`}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {isCreate
            ? 'Creates a closed entry retroactively (missed-punch recovery). Every change is logged to the audit trail.'
            : 'Changes are logged to the audit trail. Only supervisors and admins see this.'}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Start</span>
            <input
              type="datetime-local"
              required
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
              value={toLocalInputValue(values.startedAt)}
              onChange={(e) => {
                const iso = fromLocalInputValue(e.target.value);
                if (iso) setValues((v) => ({ ...v, startedAt: iso }));
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">
              End {isCreate && <span className="text-red-600">*</span>}
            </span>
            <input
              type="datetime-local"
              required={isCreate}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
              value={toLocalInputValue(values.endedAt)}
              onChange={(e) => {
                const iso = fromLocalInputValue(e.target.value);
                setValues((v) => ({ ...v, endedAt: iso }));
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Type</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
              value={values.entryType}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  entryType: e.target.value as 'work' | 'break',
                  jobId: e.target.value === 'break' ? null : v.jobId,
                }))
              }
            >
              <option value="work">Work</option>
              <option value="break">Break</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Job</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm disabled:opacity-60"
              value={values.jobId ?? ''}
              disabled={values.entryType === 'break'}
              onChange={(e) =>
                setValues((v) => ({ ...v, jobId: e.target.value ? Number(e.target.value) : null }))
              }
            >
              <option value="">— none —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code ? `${j.code} — ` : ''}
                  {j.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-700">
            Reason <span className="text-red-600">*</span>
          </span>
          <span className="text-[11px] text-slate-500">
            One line describing why. Visible in the audit trail forever.
          </span>
          <textarea
            required
            rows={2}
            maxLength={500}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
            placeholder={
              isCreate
                ? 'e.g. Forgot to punch in on Wednesday'
                : 'e.g. Corrected start time; clock drifted 30min'
            }
            value={values.reason}
            onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
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
            disabled={!canSubmit || pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? 'Saving…' : isCreate ? 'Create entry' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
