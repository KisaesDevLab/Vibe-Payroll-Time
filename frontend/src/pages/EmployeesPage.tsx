import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEmployeeRequest,
  CsvImportResponse,
  Employee,
  UpdateEmployeeRequest,
} from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { employees as employeesApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

export function EmployeesPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [revealedPin, setRevealedPin] = useState<{ employeeId: number; pin: string } | null>(
    null,
  );

  const roster = useQuery({
    queryKey: ['employees', companyId, search],
    queryFn: () => employeesApi.list(companyId, search || undefined),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['employees', companyId] });

  return (
    <>
      <header className="mb-4 flex items-center justify-between gap-4">
        <input
          type="search"
          placeholder="Search employees…"
          className="w-80 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Add employee</Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Number</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Phone</th>
              <th className="px-4 py-3 text-left font-medium">PIN</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.data?.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setSelected(e)}
              >
                <td className="px-4 py-3 font-medium text-slate-900">
                  {e.lastName}, {e.firstName}
                </td>
                <td className="px-4 py-3 text-slate-700">{e.employeeNumber ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{e.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  {e.hasPin ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      set
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">none</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-xs font-medium ' +
                      (e.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-600')
                    }
                  >
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
            {roster.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  {search ? 'No employees match your search.' : 'No employees yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateEmployeeModal
          companyId={companyId}
          onClose={() => setCreateOpen(false)}
          onCreated={(pin, id) => {
            invalidate();
            setCreateOpen(false);
            if (pin) setRevealedPin({ employeeId: id, pin });
          }}
        />
      )}

      {importOpen && (
        <ImportCsvModal
          companyId={companyId}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            invalidate();
            setImportOpen(false);
          }}
        />
      )}

      {selected && (
        <EmployeeDetailDrawer
          companyId={companyId}
          employee={selected}
          onClose={() => setSelected(null)}
          onChanged={invalidate}
          onPinRevealed={(pin) => setRevealedPin({ employeeId: selected.id, pin })}
        />
      )}

      {revealedPin && (
        <Modal
          open
          onClose={() => setRevealedPin(null)}
          title="PIN generated"
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setRevealedPin(null)}>I've copied it</Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600">
            Share this PIN with the employee. It won't be shown again.
          </p>
          <p className="mt-4 text-center font-mono text-4xl tracking-widest text-slate-900">
            {revealedPin.pin}
          </p>
        </Modal>
      )}
    </>
  );
}

function CreateEmployeeModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: number;
  onClose: () => void;
  onCreated: (plaintextPin: string | undefined, employeeId: number) => void;
}) {
  const [form, setForm] = useState<CreateEmployeeRequest>({
    firstName: '',
    lastName: '',
    generatePin: true,
    pinLength: 6,
  });

  const create = useMutation({
    mutationFn: () => employeesApi.create(companyId, form),
    onSuccess: (res) => onCreated(res.plaintextPin, res.employee.id),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add employee"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.firstName || !form.lastName}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="First name"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          />
          <FormField
            label="Last name"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          />
        </div>
        <FormField
          label="Employee number"
          value={form.employeeNumber ?? ''}
          onChange={(e) =>
            setForm((f) => ({ ...f, employeeNumber: e.target.value || undefined }))
          }
        />
        <FormField
          label="Email"
          type="email"
          value={form.email ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value || undefined }))}
        />
        <FormField
          label="Phone"
          value={form.phone ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value || undefined }))}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!form.generatePin}
            onChange={(e) => setForm((f) => ({ ...f, generatePin: e.target.checked }))}
          />
          Generate kiosk PIN on creation
        </label>
        {create.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {create.error instanceof ApiError ? create.error.message : 'Create failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ImportCsvModal({
  companyId,
  onClose,
  onImported,
}: {
  companyId: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [generatePins, setGeneratePins] = useState(true);
  const [result, setResult] = useState<CsvImportResponse | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      employeesApi.importCsv(companyId, { csv, generatePins, pinLength: 6 }),
    onSuccess: (res) => setResult(res),
  });

  return (
    <Modal
      open
      onClose={() => {
        if (result) onImported();
        onClose();
      }}
      title="Import employees from CSV"
      footer={
        <div className="flex justify-end gap-2">
          {result ? (
            <Button onClick={onImported}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={submit.isPending}
                disabled={!csv.trim()}
                onClick={() => submit.mutate()}
              >
                Import
              </Button>
            </>
          )}
        </div>
      }
    >
      {!result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">
            Paste a CSV with columns:{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
              first_name, last_name, employee_number, email, phone
            </code>
            . The first row is treated as headers.
          </p>
          <textarea
            className="h-48 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs shadow-sm"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'first_name,last_name,employee_number\nJane,Doe,E001\nJohn,Smith,E002'}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={generatePins}
              onChange={(e) => setGeneratePins(e.target.checked)}
            />
            Generate a kiosk PIN for each imported employee
          </label>
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-slate-700">
            Created <span className="font-medium">{result.created}</span>, skipped{' '}
            <span className="font-medium">{result.skipped}</span>.
          </p>
          {result.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Errors:</strong>
              <ul className="mt-2 list-disc pl-5">
                {result.errors.map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.employees.some((e) => e.plaintextPin) && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Generated PINs (shown only once)
              </p>
              <ul className="space-y-1 font-mono text-xs">
                {result.employees
                  .filter((e) => e.plaintextPin)
                  .map((e) => (
                    <li key={e.employee.id} className="flex justify-between">
                      <span>
                        {e.employee.lastName}, {e.employee.firstName}
                      </span>
                      <span className="tracking-widest text-slate-800">{e.plaintextPin}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function EmployeeDetailDrawer({
  companyId,
  employee,
  onClose,
  onChanged,
  onPinRevealed,
}: {
  companyId: number;
  employee: Employee;
  onClose: () => void;
  onChanged: () => void;
  onPinRevealed: (pin: string) => void;
}) {
  const [patch, setPatch] = useState<UpdateEmployeeRequest>({});

  const update = useMutation({
    mutationFn: () => employeesApi.update(companyId, employee.id, patch),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const regenerate = useMutation({
    mutationFn: () => employeesApi.regeneratePin(companyId, employee.id),
    onSuccess: (res) => {
      onChanged();
      if (res.plaintextPin) onPinRevealed(res.plaintextPin);
    },
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      employeesApi.update(companyId, employee.id, {
        status: employee.status === 'active' ? 'terminated' : 'active',
      }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${employee.firstName} ${employee.lastName}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            loading={regenerate.isPending}
            onClick={() => regenerate.mutate()}
            disabled={employee.status !== 'active'}
          >
            Regenerate PIN
          </Button>
          <Button
            variant="secondary"
            loading={toggleStatus.isPending}
            onClick={() => toggleStatus.mutate()}
          >
            {employee.status === 'active' ? 'Deactivate' : 'Reactivate'}
          </Button>
          <Button loading={update.isPending} onClick={() => update.mutate()}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="First name"
            defaultValue={employee.firstName}
            onChange={(e) => setPatch((p) => ({ ...p, firstName: e.target.value }))}
          />
          <FormField
            label="Last name"
            defaultValue={employee.lastName}
            onChange={(e) => setPatch((p) => ({ ...p, lastName: e.target.value }))}
          />
        </div>
        <FormField
          label="Employee number"
          defaultValue={employee.employeeNumber ?? ''}
          onChange={(e) =>
            setPatch((p) => ({ ...p, employeeNumber: e.target.value || null }))
          }
        />
        <FormField
          label="Email"
          type="email"
          defaultValue={employee.email ?? ''}
          onChange={(e) => setPatch((p) => ({ ...p, email: e.target.value || null }))}
        />
        <FormField
          label="Phone"
          defaultValue={employee.phone ?? ''}
          onChange={(e) => setPatch((p) => ({ ...p, phone: e.target.value || null }))}
        />
        <dl className="grid grid-cols-2 gap-y-1 text-xs text-slate-500">
          <dt>Status</dt>
          <dd className="text-right font-medium text-slate-800">{employee.status}</dd>
          <dt>Has PIN</dt>
          <dd className="text-right font-medium text-slate-800">
            {employee.hasPin ? 'yes' : 'no'}
          </dd>
          <dt>Created</dt>
          <dd className="text-right font-medium text-slate-800">
            {new Date(employee.createdAt).toLocaleDateString()}
          </dd>
        </dl>
        {(() => {
          const err = update.error ?? regenerate.error;
          if (!err) return null;
          return (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err instanceof ApiError ? err.message : 'Operation failed.'}
            </div>
          );
        })()}
      </div>
    </Drawer>
  );
}
