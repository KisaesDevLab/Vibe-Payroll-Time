import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteMembershipRequest, Membership } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { memberships as membershipsApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

const ROLE_LABELS: Record<Membership['role'], string> = {
  company_admin: 'Company admin',
  supervisor: 'Supervisor',
  employee: 'Employee',
};

export function TeamPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);

  const list = useQuery({
    queryKey: ['memberships', companyId],
    queryFn: () => membershipsApi.list(companyId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['memberships', companyId] });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Membership['role'] }) =>
      membershipsApi.updateRole(companyId, id, role),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: (id: number) => membershipsApi.revoke(companyId, id),
    onSuccess: invalidate,
  });

  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">Users with access to this company.</p>
        <Button onClick={() => setInviteOpen(true)}>Invite user</Button>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Added</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{m.email}</td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                    value={m.role}
                    onChange={(e) =>
                      updateRole.mutate({
                        id: m.id,
                        role: e.target.value as Membership['role'],
                      })
                    }
                  >
                    {Object.entries(ROLE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(m.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-red-700 hover:underline"
                    onClick={() => {
                      if (confirm(`Remove ${m.email} from this company?`)) revoke.mutate(m.id);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                  No members yet. Invite someone to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InviteModal
          companyId={companyId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            invalidate();
            setInviteOpen(false);
          }}
        />
      )}
    </>
  );
}

function InviteModal({
  companyId,
  onClose,
  onInvited,
}: {
  companyId: number;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [form, setForm] = useState<InviteMembershipRequest>({
    email: '',
    role: 'employee',
    initialPassword: '',
  });
  const submit = useMutation({
    mutationFn: () =>
      membershipsApi.invite(companyId, {
        email: form.email,
        role: form.role,
        ...(form.initialPassword ? { initialPassword: form.initialPassword } : {}),
      }),
    onSuccess: onInvited,
  });

  const passwordNeeded = (form.initialPassword?.length ?? 0) >= 12;
  const canSubmit = form.email.includes('@') && (form.initialPassword === '' || passwordNeeded);

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite user"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submit.isPending} disabled={!canSubmit} onClick={() => submit.mutate()}>
            Invite
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Role</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Membership['role'] }))}
          >
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <FormField
          label="Initial password"
          type="password"
          hint="Required if the email is new to the appliance. 12+ characters."
          value={form.initialPassword ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, initialPassword: e.target.value }))}
          error={
            form.initialPassword && !passwordNeeded ? 'Must be at least 12 characters' : undefined
          }
        />
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Invite failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
