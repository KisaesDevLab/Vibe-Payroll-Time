// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CorrectionRequest } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { corrections } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

export function CorrectionsPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [deciding, setDeciding] = useState<{
    request: CorrectionRequest;
    action: 'approve' | 'reject';
  } | null>(null);

  const list = useQuery({
    queryKey: ['corrections', companyId, filter],
    queryFn: () => corrections.list(companyId, filter === 'all' ? undefined : filter),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['corrections', companyId] });

  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-0.5 text-xs">
          {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={
                'rounded px-3 py-1.5 capitalize transition ' +
                (filter === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')
              }
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {list.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {list.data?.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No correction requests {filter !== 'all' && `with status "${filter}"`}.
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {list.data?.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  #{r.id} ·{' '}
                  <span
                    className={
                      'ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                      badgeClass(r.status)
                    }
                  >
                    {r.status}
                  </span>{' '}
                  · {r.requestType}
                </p>
                <p className="mt-1 text-sm text-slate-800">Employee #{r.employeeId}</p>
                <p className="mt-2 text-sm text-slate-700">{r.reason}</p>
                <pre className="mt-2 overflow-x-auto rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-700">
                  {JSON.stringify(r.proposedChanges, null, 2)}
                </pre>
                <p className="mt-2 text-xs text-slate-500">
                  Submitted {new Date(r.createdAt).toLocaleString()}
                  {r.reviewedAt && (
                    <>
                      {' '}
                      · reviewed {new Date(r.reviewedAt).toLocaleString()}
                      {r.reviewNote && ` — "${r.reviewNote}"`}
                    </>
                  )}
                </p>
              </div>
              {r.status === 'pending' && (
                <div className="flex shrink-0 flex-col gap-2">
                  <Button onClick={() => setDeciding({ request: r, action: 'approve' })}>
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setDeciding({ request: r, action: 'reject' })}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {deciding && (
        <DecideModal
          companyId={companyId}
          request={deciding.request}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function DecideModal({
  companyId,
  request,
  action,
  onClose,
  onDecided,
}: {
  companyId: number;
  request: CorrectionRequest;
  action: 'approve' | 'reject';
  onClose: () => void;
  onDecided: () => void;
}) {
  const [note, setNote] = useState('');
  const submit = useMutation({
    mutationFn: () =>
      action === 'approve'
        ? corrections.approve(companyId, request.id, { reviewNote: note })
        : corrections.reject(companyId, request.id, { reviewNote: note }),
    onSuccess: onDecided,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${action === 'approve' ? 'Approve' : 'Reject'} request #${request.id}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submit.isPending} onClick={() => submit.mutate()}>
            Confirm {action}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          {action === 'approve'
            ? 'The proposed change will be applied through the normal edit path and appear in the entry audit trail.'
            : 'The request is marked rejected. No changes to the entry.'}
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Note (optional)</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Failed to submit decision.'}
          </div>
        )}
      </div>
    </Modal>
  );
}

function badgeClass(status: CorrectionRequest['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'approved':
      return 'bg-emerald-100 text-emerald-800';
    case 'rejected':
      return 'bg-slate-200 text-slate-700';
  }
}
