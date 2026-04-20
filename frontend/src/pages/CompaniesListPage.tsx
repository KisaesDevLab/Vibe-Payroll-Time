import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCompanyRequest } from '@vibept/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { TopBar } from '../components/TopBar';
import { ApiError, apiFetch } from '../lib/api';
import { companies as companiesApi, licensing } from '../lib/resources';

const TZ_GUESS = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

export function CompaniesListPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateCompanyRequest>({
    name: '',
    slug: '',
    timezone: TZ_GUESS,
    weekStartDay: 0,
    payPeriodType: 'bi_weekly',
    isInternal: false,
  });

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: companiesApi.list,
  });

  const create = useMutation({
    mutationFn: (body: CreateCompanyRequest) =>
      apiFetch('/companies', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      setShowCreate(false);
      setForm({
        name: '',
        slug: '',
        timezone: TZ_GUESS,
        weekStartDay: 0,
        payPeriodType: 'bi_weekly',
        isInternal: false,
      });
    },
  });

  const toggleInternal = useMutation({
    mutationFn: ({ id, isInternal }: { id: number; isInternal: boolean }) =>
      licensing.setInternalFlag(id, isInternal),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">All companies</h1>
            <p className="mt-1 text-sm text-slate-600">
              SuperAdmin view. All companies hosted on this appliance.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>New company</Button>
        </header>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Company</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">License</th>
                <th className="px-4 py-3 text-left font-medium">Pay period</th>
                <th className="px-4 py-3 text-right font-medium">Employees</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.data?.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !c.isInternal;
                        if (
                          confirm(
                            next
                              ? `Mark "${c.name}" as internal? Licensing will no longer apply to this company.`
                              : `Unmark "${c.name}" as internal? It will revert to trial and need a license.`,
                          )
                        )
                          toggleInternal.mutate({ id: c.id, isInternal: next });
                      }}
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium transition ' +
                        (c.isInternal
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                      }
                      title="Click to toggle"
                    >
                      {c.isInternal ? 'Internal' : 'Client'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{c.licenseState.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-700">{c.payPeriodType.replace('_', '-')}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900">
                    {c.employeeCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/companies/${c.id}/employees`}
                      className="text-sm font-medium text-slate-900 hover:underline"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
              {companies.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No companies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create company"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              onClick={() => create.mutate(form)}
              disabled={!form.name || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(form.slug)}
            >
              Create
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField
            label="Company name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <FormField
            label="Slug"
            hint="kebab-case, used in URLs"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
          />
          <FormField
            label="Timezone"
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!form.isInternal}
              onChange={(e) => setForm((f) => ({ ...f, isInternal: e.target.checked }))}
            />
            Internal firm company (never licensed)
          </label>

          {create.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {create.error instanceof ApiError ? create.error.message : 'Create failed.'}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
