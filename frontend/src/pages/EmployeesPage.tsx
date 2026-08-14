// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BadgeEvent,
  CreateEmployeeRequest,
  CsvImportResponse,
  Employee,
  EmployeeBadgeState,
  IssueBadgeResponse,
  MagicLinkOptionsResponse,
  UpdateEmployeeRequest,
} from '@vibept/shared';
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { SendLinkMenu } from '../components/SendLinkMenu';
import { ApiError, apiFetch } from '../lib/api';
import { badges as badgesApi, employees as employeesApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

export function EmployeesPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [revealedPin, setRevealedPin] = useState<{ employeeId: number; pin: string } | null>(null);
  const [issuedBadge, setIssuedBadge] = useState<IssueBadgeResponse | null>(null);

  const roster = useQuery({
    queryKey: ['employees', companyId, search],
    queryFn: () => employeesApi.list(companyId, search || undefined),
  });

  const badgeStates = useQuery({
    queryKey: ['badge-states', companyId, (roster.data ?? []).map((e) => e.id).join(',')],
    queryFn: async () => {
      const ids = (roster.data ?? []).map((e) => e.id);
      const entries = await Promise.all(
        ids.map((id) =>
          badgesApi
            .getState(companyId, id)
            .then((s) => [id, s] as const)
            .catch(() => [id, null] as const),
        ),
      );
      const out: Record<number, EmployeeBadgeState | null> = {};
      for (const [id, s] of entries) out[id] = s;
      return out;
    },
    enabled: (roster.data ?? []).length > 0,
  });

  const bulkIssue = useMutation({
    mutationFn: () => badgesApi.bulkIssuePrint(companyId, { employeeIds: Array.from(selectedIds) }),
    onSuccess: () => {
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['badge-states', companyId] });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['employees', companyId] });
    qc.invalidateQueries({ queryKey: ['badge-states', companyId] });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          {selectedIds.size > 0 && (
            <Button
              variant="secondary"
              loading={bulkIssue.isPending}
              onClick={() => bulkIssue.mutate()}
            >
              Issue badges for {selectedIds.size}…
            </Button>
          )}
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Add employee</Button>
        </div>
      </header>
      {bulkIssue.isError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {bulkIssue.error instanceof Error ? bulkIssue.error.message : 'Bulk badge issue failed.'}
        </div>
      )}

      <AccessLinksCard />

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3 text-left font-medium">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Number</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">PIN</th>
              <th className="px-4 py-3 text-left font-medium">Badge</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.data?.map((e) => {
              const badge = badgeStates.data?.[e.id] ?? null;
              return (
                <tr
                  key={e.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setSelected(e)}
                >
                  <td
                    className="px-4 py-3"
                    onClick={(ev) => {
                      ev.stopPropagation();
                    }}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      aria-label={`Select ${e.firstName} ${e.lastName}`}
                      checked={selectedIds.has(e.id)}
                      disabled={e.status !== 'active'}
                      onChange={() => toggleSelect(e.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {e.lastName}, {e.firstName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{e.employeeNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{e.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <PinCell employee={e} />
                  </td>
                  <td className="px-4 py-3">
                    <BadgeStatusPill state={badge} />
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
              );
            })}
            {roster.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
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
          onBadgeIssued={(issued) => setIssuedBadge(issued)}
        />
      )}

      {issuedBadge && (
        <IssuedBadgeModal issued={issuedBadge} onClose={() => setIssuedBadge(null)} />
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

  // Invite-on-create. Both default off: creating an employee record and
  // granting them a web login are separate decisions, and plenty of
  // hourly staff are kiosk-only by design.
  const [inviteEmail, setInviteEmail] = useState(false);
  const [inviteSms, setInviteSms] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ['magic-options'],
    queryFn: () => apiFetch<MagicLinkOptionsResponse>('/auth/magic/options', { anonymous: true }),
    staleTime: 60_000,
    retry: false,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await employeesApi.create(companyId, form);

      // Send after the record exists, one call per chosen channel. The
      // first one creates the web login (createLogin), the second finds
      // it already there — so ticking both doesn't make two accounts.
      const channels: Array<'email' | 'sms'> = [
        ...(inviteEmail ? (['email'] as const) : []),
        ...(inviteSms ? (['sms'] as const) : []),
      ];
      const problems: string[] = [];
      for (const channel of channels) {
        try {
          const sent = await employeesApi.sendLink(companyId, res.employee.id, {
            channel,
            purpose: 'login',
            createLogin: true,
          });
          if (sent.status !== 'sent' && sent.status !== 'queued') {
            problems.push(
              `${channel}: not sent (${sent.status})${sent.error ? ` — ${sent.error}` : ''}`,
            );
          }
        } catch (err) {
          // Never fail the whole create over a delivery problem — the
          // employee record is the thing that matters and it already
          // exists. Report it and let them retry from the drawer.
          problems.push(`${channel}: ${err instanceof ApiError ? err.message : 'send failed'}`);
        }
      }
      return { res, problems };
    },
    onSuccess: ({ res, problems }) => {
      if (problems.length > 0) {
        setNotice(
          `Employee created, but the invite didn't go out — ${problems.join('; ')}. ` +
            'Open their record and use "Send sign-in link" to retry.',
        );
        return;
      }
      onCreated(res.plaintextPin, res.employee.id);
    },
  });

  const emailAvailable = !!options.data?.emailEnabled;
  const smsAvailable = !!options.data?.smsEnabled;

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
            // Either invite channel needs an email address: the login
            // account is keyed on it, even when the link goes by text.
            disabled={
              !form.firstName || !form.lastName || ((inviteEmail || inviteSms) && !form.email)
            }
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
          onChange={(e) => setForm((f) => ({ ...f, employeeNumber: e.target.value || undefined }))}
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

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-slate-500">
            Web login invite
          </legend>
          <p className="mb-2 text-xs text-slate-600">
            Optional. Creates a login for this person and sends a link so they choose their own
            password. Leave both off for kiosk-only staff.
          </p>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={inviteEmail}
              disabled={!emailAvailable || !form.email}
              onChange={(e) => setInviteEmail(e.target.checked)}
            />
            Email them a sign-in link
          </label>
          {!form.email && (
            <p className="pl-6 text-xs text-slate-500">Add an email address above to enable.</p>
          )}
          {form.email && !emailAvailable && (
            <p className="pl-6 text-xs text-slate-500">
              No email transport configured on this appliance.
            </p>
          )}

          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={inviteSms}
              disabled={!smsAvailable || !form.phone}
              onChange={(e) => setInviteSms(e.target.checked)}
            />
            Text them a sign-in link
          </label>
          {!form.phone && (
            <p className="pl-6 text-xs text-slate-500">Add a phone number above to enable.</p>
          )}
          {form.phone && !smsAvailable && (
            <p className="pl-6 text-xs text-slate-500">
              No SMS provider configured for this company or appliance.
            </p>
          )}

          {/* A new hire has no way to verify a number until they can sign
              in, and this text is how they sign in — so the send goes to
              an unconfirmed number by design. Say so: a mistyped digit
              delivers a working sign-in link to a stranger. */}
          {inviteSms && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              This texts a number nobody has confirmed yet. Double-check the digits before creating.
            </p>
          )}

          {!form.email && inviteSms && (
            <p className="mt-2 text-xs text-slate-600">
              An email address is still required — it's the identity of the login account.
            </p>
          )}
        </fieldset>

        {notice && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {notice}
          </div>
        )}
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
    mutationFn: () => employeesApi.importCsv(companyId, { csv, generatePins, pinLength: 6 }),
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
  onBadgeIssued,
}: {
  companyId: number;
  employee: Employee;
  onClose: () => void;
  onChanged: () => void;
  onPinRevealed: (pin: string) => void;
  onBadgeIssued: (issued: IssueBadgeResponse) => void;
}) {
  const [patch, setPatch] = useState<UpdateEmployeeRequest>({});
  const [setPinOpen, setSetPinOpen] = useState(false);
  const navigate = useNavigate();

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
            onClick={() => navigate(`/companies/${companyId}/timesheets/${employee.id}/week`)}
          >
            Weekly grid
          </Button>
          <Button
            variant="secondary"
            onClick={() => setSetPinOpen(true)}
            disabled={employee.status !== 'active'}
          >
            Set PIN…
          </Button>
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
          onChange={(e) => setPatch((p) => ({ ...p, employeeNumber: e.target.value || null }))}
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
        <EmployeeLoginPanel companyId={companyId} employee={employee} onChanged={onChanged} />
        <EmployeeBadgePanel
          companyId={companyId}
          employee={employee}
          onBadgeIssued={onBadgeIssued}
          onChanged={onChanged}
        />
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
      {setPinOpen && (
        <SetPinModal
          companyId={companyId}
          employee={employee}
          onClose={() => setSetPinOpen(false)}
          onSaved={onChanged}
        />
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Web login
// ---------------------------------------------------------------------------

/**
 * Sign-in link / password reset, from the employee record.
 *
 * The same actions exist on the Team page, but Team is keyed on user
 * accounts — an admin looking at a person's employee record shouldn't
 * have to go find their membership row by email to send them a
 * password reset. Three states:
 *
 *   - linked to a user account  → send / re-send anything
 *   - no account, has an email  → offer to create one and invite
 *   - no account, no email      → kiosk-only; explain, don't nag
 */
function EmployeeLoginPanel({
  companyId,
  employee,
  onChanged,
}: {
  companyId: number;
  employee: Employee;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (channel: 'email' | 'sms') =>
      employeesApi.sendLink(companyId, employee.id, {
        channel,
        purpose: 'login',
        createLogin: true,
      }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (r) => {
      const delivered = r.status === 'sent' || r.status === 'queued';
      setNotice(
        delivered
          ? `${r.loginCreated ? 'Login created. ' : ''}Sign-in link sent to ${r.sentTo}.` +
              (r.phoneUnverified ? ' (unconfirmed number — check the digits)' : '')
          : `Not sent (${r.status})${r.error ? ` — ${r.error}` : ''}.`,
      );
      // The employee row now carries a user_id; refresh so the panel
      // switches to its linked state without a manual reload.
      if (r.loginCreated) onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send the link.'),
  });

  if (employee.userId) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Web login</p>
            <p className="text-xs text-slate-600">
              Enabled · signs in at the app with {employee.email ?? 'their email'}
            </p>
          </div>
          <SendLinkMenu
            send={(body) => employeesApi.sendLink(companyId, employee.id, body)}
            label="Send link"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Web login</p>

      {!employee.email ? (
        <p className="mt-1 text-xs text-slate-600">
          Not set up. This employee punches at a kiosk with their PIN or badge. Add an email address
          above and save to enable web sign-in.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-600">
            Not set up. Create a login and send {employee.firstName} a link to choose their own
            password.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={invite.isPending || employee.status !== 'active'}
              onClick={() => invite.mutate('email')}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Create login & email link
            </button>
            {employee.phone && (
              <button
                type="button"
                disabled={invite.isPending || employee.status !== 'active'}
                onClick={() => invite.mutate('sms')}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Create login & text link
              </button>
            )}
          </div>
          {employee.status !== 'active' && (
            <p className="mt-2 text-xs text-slate-500">
              Reactivate this employee first — terminated staff can't be given a login.
            </p>
          )}
        </>
      )}

      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge UI
// ---------------------------------------------------------------------------

function BadgeStatusPill({ state }: { state: EmployeeBadgeState | null }) {
  if (!state || state.state === 'none') {
    return <span className="text-xs text-slate-400">none</span>;
  }
  if (state.state === 'revoked') {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
        revoked
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      active · v{state.version}
    </span>
  );
}

function EmployeeBadgePanel({
  companyId,
  employee,
  onBadgeIssued,
  onChanged,
}: {
  companyId: number;
  employee: Employee;
  onBadgeIssued: (issued: IssueBadgeResponse) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();

  const state = useQuery({
    queryKey: ['badge', companyId, employee.id],
    queryFn: () => badgesApi.getState(companyId, employee.id),
  });

  const events = useQuery({
    queryKey: ['badge-events', companyId, employee.id],
    queryFn: () => badgesApi.events(companyId, employee.id),
  });

  const issue = useMutation({
    mutationFn: () => badgesApi.issue(companyId, employee.id),
    onSuccess: (issued) => {
      onBadgeIssued(issued);
      void state.refetch();
      void events.refetch();
      qc.invalidateQueries({ queryKey: ['badge-states', companyId] });
      onChanged();
    },
  });

  const revoke = useMutation({
    mutationFn: () => badgesApi.revoke(companyId, employee.id, 'Admin revoked from drawer'),
    onSuccess: () => {
      void state.refetch();
      void events.refetch();
      qc.invalidateQueries({ queryKey: ['badge-states', companyId] });
      onChanged();
    },
  });

  const current = state.data;
  const hasActive = current?.state === 'active';
  const isRevoked = current?.state === 'revoked';

  const confirmRevoke = () => {
    if (confirm('Revoke this badge? The printed card will stop scanning immediately.')) {
      revoke.mutate();
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">QR badge</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {hasActive &&
              `Active (v${current?.version}) · issued ${current && current.issuedAt ? new Date(current.issuedAt).toLocaleDateString() : '—'}`}
            {isRevoked && `Revoked · last v${current?.version}`}
            {current?.state === 'none' && 'No badge issued yet.'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasActive && (
            <Button variant="ghost" loading={revoke.isPending} onClick={confirmRevoke}>
              Revoke
            </Button>
          )}
          <Button
            loading={issue.isPending}
            onClick={() => issue.mutate()}
            disabled={employee.status !== 'active'}
          >
            {hasActive ? 'Reissue' : 'Issue badge'}
          </Button>
        </div>
      </div>
      {(issue.error || revoke.error) && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {issue.error instanceof ApiError
            ? issue.error.message
            : revoke.error instanceof ApiError
              ? revoke.error.message
              : 'Badge action failed.'}
        </div>
      )}
      {events.data && events.data.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
            Recent activity ({events.data.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {events.data.slice(0, 10).map((ev) => (
              <li key={ev.id} className="flex justify-between gap-4">
                <span>{badgeEventLabel(ev)}</span>
                <span className="text-slate-400">{new Date(ev.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function badgeEventLabel(ev: BadgeEvent): string {
  const reason = typeof ev.metadata.reason === 'string' ? ` (${ev.metadata.reason})` : '';
  switch (ev.eventType) {
    case 'issue':
      return `Issued v${typeof ev.metadata.version === 'number' ? ev.metadata.version : '?'}`;
    case 'revoke':
      return `Revoked${reason}`;
    case 'scan_success':
      return 'Scan — success';
    case 'scan_failure':
      return `Scan failed${reason}`;
  }
}

function IssuedBadgeModal({
  issued,
  onClose,
}: {
  issued: IssueBadgeResponse;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Badge v${issued.version} issued`}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>I've saved this</Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4 text-sm text-slate-700">
        <p>
          Print this QR code and hand it to the employee. Dismissing this dialog is non-recoverable
          — if you lose the code you must reissue to get a new one, which invalidates any prior
          printed badge.
        </p>
        <img
          src={issued.qrDataUrl}
          alt="QR badge"
          className="h-64 w-64 rounded border border-slate-200 bg-white p-2"
        />
        <div className="flex gap-2">
          <a
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            href={issued.qrDataUrl}
            download={`badge-${issued.employeeId}-v${issued.version}.png`}
          >
            Download PNG
          </a>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={() => window.print()}
          >
            Print
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------- PIN cell + modal ---------------------------

function PinCell({ employee }: { employee: Employee }) {
  const [copied, setCopied] = useState(false);
  const pin = employee.pin;

  if (!employee.hasPin) {
    return <span className="text-xs text-slate-400">none</span>;
  }
  if (!pin) {
    // Employee has a hashed PIN from before pin_encrypted was added —
    // we can't display it. Tell the admin what to do.
    return (
      <span
        className="cursor-help text-xs text-slate-500 underline decoration-dotted"
        title="This PIN was set before the encrypt-at-rest upgrade. Open the employee and regenerate or set manually to make it visible."
      >
        set (legacy)
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(pin).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-sm tracking-widest text-slate-900 hover:bg-slate-100"
      title="Click to copy"
    >
      {pin}
      {copied && <span className="ml-2 text-[10px] text-emerald-700">✓ copied</span>}
    </button>
  );
}

function SetPinModal({
  companyId,
  employee,
  onClose,
  onSaved,
}: {
  companyId: number;
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState('');
  const save = useMutation({
    mutationFn: () => employeesApi.setPin(companyId, employee.id, pin),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const digitsOk = /^\d{4,6}$/.test(pin);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Set PIN for ${employee.firstName} ${employee.lastName}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!digitsOk} loading={save.isPending} onClick={() => save.mutate()}>
            Save PIN
          </Button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">
        4–6 digits. Weak patterns (<code>1234</code>, <code>1111</code>, etc.) are rejected — the
        server uses the same rules as the auto-generator.
      </p>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        autoFocus
        className="mt-4 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center font-mono text-2xl tracking-widest shadow-sm"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      />
      {save.isError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {save.error instanceof ApiError ? save.error.message : 'Failed to set PIN.'}
        </div>
      )}
    </Modal>
  );
}

// ------------------------- Access URLs card -----------------------------

/**
 * Surfaces the employee-facing login URL — the one employees open on
 * their personal phone for the PWA. The kiosk pairing URL used to
 * live here too but was moved to the Kiosks tab where it belongs
 * alongside the paired-devices list.
 */
function AccessLinksCard() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const loginUrl = `${origin}/login`;
  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Employee login link</h2>
      <p className="mt-1 text-xs text-slate-500">
        Share this URL — employees open it on their phone to sign in and punch. The kiosk pairing
        URL lives on the Kiosks tab.
      </p>
      <div className="mt-3">
        <CopyableUrl label="Employee login" url={loginUrl} />
      </div>
    </section>
  );
}

function CopyableUrl({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
        <p className="truncate font-mono text-xs text-slate-800">{url}</p>
      </div>
      <button
        type="button"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
        onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}
