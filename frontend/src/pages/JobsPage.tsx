import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateJobRequest, Job, UpdateJobRequest } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { jobs as jobsApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

export function JobsPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery({
    queryKey: ['jobs', companyId, includeArchived],
    queryFn: () => jobsApi.list(companyId, includeArchived),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['jobs', companyId] });

  const archive = useMutation({
    mutationFn: (id: number) => jobsApi.archive(companyId, id),
    onSuccess: invalidate,
  });
  const unarchive = useMutation({
    mutationFn: (id: number) => jobsApi.unarchive(companyId, id),
    onSuccess: invalidate,
  });

  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <Button onClick={() => setCreateOpen(true)}>New job</Button>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Code</th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-3 font-mono text-slate-900">{j.code}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{j.name}</div>
                  {j.description && (
                    <div className="text-xs text-slate-500">{j.description}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {j.archivedAt ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                      archived
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-700 hover:underline"
                      onClick={() => setEditing(j)}
                    >
                      Edit
                    </button>
                    {j.archivedAt ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-700 hover:underline"
                        onClick={() => unarchive.mutate(j.id)}
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-medium text-red-700 hover:underline"
                        onClick={() => {
                          if (confirm(`Archive job ${j.code}?`)) archive.mutate(j.id);
                        }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <JobEditorModal
          companyId={companyId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            invalidate();
            setCreateOpen(false);
          }}
        />
      )}
      {editing && (
        <JobEditorModal
          companyId={companyId}
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function JobEditorModal({
  companyId,
  job,
  onClose,
  onSaved,
}: {
  companyId: number;
  job?: Job;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateJobRequest>({
    code: job?.code ?? '',
    name: job?.name ?? '',
    ...(job?.description ? { description: job.description } : {}),
  });

  const submit = useMutation({
    mutationFn: () =>
      job
        ? jobsApi.update(companyId, job.id, form satisfies UpdateJobRequest)
        : jobsApi.create(companyId, form),
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={job ? `Edit job ${job.code}` : 'New job'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={!form.code || !form.name}
            onClick={() => submit.mutate()}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Code"
          hint="Short identifier your team recognizes, e.g. `1204` or `ACME-ROOF`."
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
        />
        <FormField
          label="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            rows={3}
            value={form.description ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value || undefined }))
            }
          />
        </label>
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Save failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
