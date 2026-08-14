// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteMembershipRequest, MagicLinkOptionsResponse, Membership } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { SendLinkMenu } from '../components/SendLinkMenu';
import { ApiError, apiFetch } from '../lib/api';
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
                <td className="px-4 py-3">
                  <div className="flex items-start justify-end gap-3">
                    <SendLinkMenu send={(body) => membershipsApi.sendLink(companyId, m.id, body)} />
                    <button
                      type="button"
                      className="min-h-[34px] text-sm font-medium text-red-700 hover:underline"
                      onClick={() => {
                        if (confirm(`Remove ${m.email} from this company?`)) revoke.mutate(m.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
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
    sendInvite: true,
  });

  // Which channel the invite goes out on. Only offered when the
  // appliance can actually deliver — see SendLinkMenu for the same
  // gate on the per-row control.
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const options = useQuery({
    queryKey: ['magic-options'],
    queryFn: () => apiFetch<MagicLinkOptionsResponse>('/auth/magic/options', { anonymous: true }),
    staleTime: 60_000,
    retry: false,
  });
  const canSend = !!options.data?.emailEnabled || !!options.data?.smsEnabled;

  const [outcome, setOutcome] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const membership = await membershipsApi.invite(companyId, {
        email: form.email,
        role: form.role,
        sendInvite: form.sendInvite,
        ...(form.sendInvite || !form.initialPassword
          ? {}
          : { initialPassword: form.initialPassword }),
      });

      // Two calls rather than one: creating the account and telling the
      // person about it are genuinely separate operations, and keeping
      // them apart means a delivery failure doesn't roll back a
      // membership the admin still wants. If the send fails they get a
      // created member plus an explanation, and the row's own "Send
      // link" button to retry with.
      if (!form.sendInvite) return { membership, sent: null };
      const sent = await membershipsApi.sendLink(companyId, membership.id, {
        channel,
        purpose: 'login',
      });
      return { membership, sent };
    },
    onSuccess: ({ sent }) => {
      if (sent && sent.status !== 'sent' && sent.status !== 'queued') {
        // Member exists but nothing went out. Hold the modal open with
        // the reason rather than closing on a silent non-delivery.
        setOutcome(
          `Member added, but the invite was not sent (${sent.status})${
            sent.error ? ` — ${sent.error}` : ''
          }. Use "Send link" on their row to retry.`,
        );
        return;
      }
      onInvited();
    },
  });

  const passwordOk = (form.initialPassword?.length ?? 0) >= 12;
  const canSubmit =
    form.email.includes('@') &&
    (form.sendInvite ? canSend : form.initialPassword === '' || passwordOk);

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
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-widest text-slate-500">
            How they get in
          </legend>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={!!form.sendInvite}
              disabled={!canSend}
              onChange={() => setForm((f) => ({ ...f, sendInvite: true }))}
            />
            <span>
              <span className="font-medium text-slate-800">Send them a sign-in link</span>
              <span className="block text-xs text-slate-600">
                No password is set. They click the link and choose their own — nothing to read
                aloud, nothing to write down.
                {!canSend && ' Unavailable: no email or SMS transport configured.'}
              </span>
            </span>
          </label>

          {form.sendInvite && canSend && (
            <div className="mt-2 flex gap-2 pl-6">
              {(['email', 'sms'] as const).map((c) => {
                const enabled =
                  c === 'email' ? !!options.data?.emailEnabled : !!options.data?.smsEnabled;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setChannel(c)}
                    className={
                      'rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ' +
                      (channel === c
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700')
                    }
                  >
                    {c === 'email' ? 'Email' : 'Text'}
                  </button>
                );
              })}
            </div>
          )}

          {/* SMS needs a verified number, which a brand-new user can't
              have yet — their employee record doesn't exist at invite
              time. Say so before they pick it and get a skip. */}
          {form.sendInvite && channel === 'sms' && (
            <p className="mt-2 pl-6 text-xs text-amber-700">
              Texting works only if this person already has a verified phone on an employee record.
              For a brand-new hire, send by email.
            </p>
          )}

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={!form.sendInvite}
              onChange={() => setForm((f) => ({ ...f, sendInvite: false }))}
            />
            <span className="font-medium text-slate-800">Set an initial password myself</span>
          </label>

          {!form.sendInvite && (
            <div className="mt-2 pl-6">
              <FormField
                label="Initial password"
                type="password"
                hint="Required if the email is new to the appliance. 12+ characters. You'll need to pass it along out-of-band."
                value={form.initialPassword ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, initialPassword: e.target.value }))}
                error={
                  form.initialPassword && !passwordOk ? 'Must be at least 12 characters' : undefined
                }
              />
            </div>
          )}
        </fieldset>

        {outcome && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {outcome}
          </div>
        )}
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Invite failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
