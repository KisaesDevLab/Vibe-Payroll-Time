// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AdminUsersResponse, CompanyRole } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { admin } from '../lib/resources';

/**
 * SuperAdmin-only cross-company view of every user account on the
 * appliance, with a matrix-style membership editor that lets you
 * add, remove, and reassign roles across any number of companies in
 * a single save.
 */
export function AllUsersPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => admin.listUsers(),
  });

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const all = data?.users ?? [];
    if (!filter.trim()) return all;
    const needle = filter.trim().toLowerCase();
    return all.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) ||
        u.memberships.some((m) => m.companyName.toLowerCase().includes(needle)),
    );
  }, [data, filter]);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">People</h1>
            <p className="mt-1 text-sm text-slate-600">
              Every user account on the appliance and which companies they belong to. Click a row to
              add, remove, or reassign memberships across multiple companies at once.
            </p>
          </div>
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
            placeholder="Filter by email or company…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </header>

        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error instanceof ApiError ? error.message : 'Failed to load users.'}
          </p>
        )}

        {data && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Memberships</th>
                  <th className="px-4 py-3 text-left font-medium">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{u.email}</div>
                      <div className="text-xs text-slate-500">
                        {u.phone ?? 'no phone'}
                        {u.phone && (u.phoneVerified ? ' · verified' : ' · unverified')}
                        {u.disabled && ' · disabled'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.roleGlobal === 'super_admin' ? (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                          SuperAdmin
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.memberships.length === 0 ? (
                        <span className="text-xs text-slate-500">none</span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {u.memberships.map((m) => (
                            <li
                              key={m.companyId}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                            >
                              <span className="font-medium">{m.companyName}</span>
                              <span className="text-slate-500">· {m.role.replace('_', ' ')}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                      No users match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}
      </main>

      {selected && data && (
        <MembershipsDrawer
          user={selected}
          companies={data.companies}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function MembershipsDrawer({
  user,
  companies,
  onClose,
}: {
  user: AdminUser;
  companies: AdminUsersResponse['companies'];
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  // Draft state: a Map of companyId → role (absent = not a member).
  const [draft, setDraft] = useState<Map<number, CompanyRole>>(() => {
    const m = new Map<number, CompanyRole>();
    for (const mem of user.memberships) m.set(mem.companyId, mem.role);
    return m;
  });

  const save = useMutation({
    mutationFn: () =>
      admin.setMemberships(user.id, {
        memberships: Array.from(draft.entries()).map(([companyId, role]) => ({ companyId, role })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const changed = useMemo(() => {
    if (draft.size !== user.memberships.length) return true;
    for (const [companyId, role] of draft.entries()) {
      const existing = user.memberships.find((m) => m.companyId === companyId);
      if (!existing || existing.role !== role) return true;
    }
    return false;
  }, [draft, user.memberships]);

  function toggleAll(checked: boolean, role: CompanyRole) {
    const next = new Map(draft);
    for (const c of sortedCompanies) {
      if (checked) next.set(c.id, role);
      else next.delete(c.id);
    }
    setDraft(next);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Memberships · ${user.email}`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {draft.size} membership{draft.size === 1 ? '' : 's'}
            {changed && ' · unsaved'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!changed || save.isPending}
              loading={save.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {user.roleGlobal === 'super_admin' && (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            This user is a SuperAdmin — they already have access to every company regardless of the
            membership rows below. Memberships still determine their company-level role and what
            shows up on their dashboard.
          </p>
        )}

        <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <span className="text-xs font-semibold text-slate-700">Bulk:</span>
          <button
            type="button"
            onClick={() => toggleAll(true, 'employee')}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
          >
            Add to all as employee
          </button>
          <button
            type="button"
            onClick={() => toggleAll(true, 'supervisor')}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
          >
            Add to all as supervisor
          </button>
          <button
            type="button"
            onClick={() => toggleAll(true, 'company_admin')}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
          >
            Add to all as admin
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false, 'employee')}
            className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          >
            Remove from all
          </button>
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2 text-left font-medium">Member?</th>
              <th className="py-2 text-left font-medium">Company</th>
              <th className="py-2 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedCompanies.map((c) => {
              const current = draft.get(c.id);
              const isMember = current != null;
              return (
                <tr key={c.id}>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={isMember}
                      onChange={(e) => {
                        const next = new Map(draft);
                        if (e.target.checked) next.set(c.id, current ?? 'employee');
                        else next.delete(c.id);
                        setDraft(next);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {c.slug}
                      {c.isInternal && ' · internal'}
                    </div>
                  </td>
                  <td className="py-2">
                    <select
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm disabled:opacity-50"
                      value={current ?? 'employee'}
                      disabled={!isMember}
                      onChange={(e) => {
                        const next = new Map(draft);
                        next.set(c.id, e.target.value as CompanyRole);
                        setDraft(next);
                      }}
                    >
                      <option value="employee">employee</option>
                      <option value="supervisor">supervisor</option>
                      <option value="company_admin">company admin</option>
                    </select>
                  </td>
                </tr>
              );
            })}
            {sortedCompanies.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-xs text-slate-500">
                  No companies on the appliance yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {save.error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {save.error instanceof ApiError ? save.error.message : 'Save failed.'}
          </p>
        )}
      </div>
    </Drawer>
  );
}
