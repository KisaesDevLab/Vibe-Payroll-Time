// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { WeeklyGridJob } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';

/**
 * Lightweight picker for adding a job row to the Weekly Grid when the
 * "Active this week" filter is on. Lists every active job the grid
 * knows about minus the ones already showing as a row, and lets the
 * caller pick one. The parent (WeeklyGridPage) handles what happens
 * after a pick — typically: pin the job for this session so its row
 * stays visible, then open CellEditPopover on today's column so the
 * user can enter hours right away.
 *
 * Deliberately narrow: same codeword + name substring match idiom as
 * EmployeesPage.tsx (roster search) so UI feels consistent.
 */
export function AddJobPicker({
  open,
  jobs,
  excludedIds,
  onPick,
  onClose,
}: {
  open: boolean;
  jobs: WeeklyGridJob[];
  excludedIds: Set<number>;
  onPick: (jobId: number) => void;
  onClose: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');

  const candidates = useMemo(() => {
    const base = jobs.filter((j) => !excludedIds.has(j.id));
    const needle = search.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(
      (j) => j.code.toLowerCase().includes(needle) || j.name.toLowerCase().includes(needle),
    );
  }, [jobs, excludedIds, search]);

  return (
    <Modal open={open} onClose={onClose} title="Add job to grid">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Pick a job that isn't already a row. It'll be added for this session and the editor will
          open so you can log hours right away.
        </p>
        <input
          type="search"
          placeholder="Search by code or name…"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {candidates.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            {jobs.length === 0
              ? 'No active jobs at this company yet.'
              : search.trim()
                ? 'No jobs match that search.'
                : 'Every active job already has a row on the grid.'}
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {candidates.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(j.id);
                    setSearch('');
                  }}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-3 text-left hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900">{j.code}</span>
                  <span className="text-xs text-slate-500">{j.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
