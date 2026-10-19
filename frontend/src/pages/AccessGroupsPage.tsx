// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessGroup, CompanyRole } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { FormField } from '../components/FormField';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { admin } from '../lib/resources';

const ROLE_LABELS: Record<CompanyRole, string> = {
  employee: 'employee',
  supervisor: 'supervisor',
  company_admin: 'company admin',
};

/**
 * SuperAdmin-only. Access groups decide which of the firm's staff can
 * reach which companies: a group's members get each of its companies at
 * the group's role, and lose it when removed from the group (or the
 * group from the company). The grants show up on the Team and People
 * pages as "via group" and can only be changed here.
 */
export function AccessGroupsPage(): JSX.Element {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['access-groups'], queryFn: admin.listAccessGroups });
  const people = useQuery({ queryKey: ['admin-users'], queryFn: admin.listUsers });
  const [editing, setEditing] = useState<AccessGroup | null>(null);
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => admin.createAccessGroup({ name: name.trim() }),
    onSuccess: (group) => {
      setName('');
      qc.invalidateQueries({ queryKey: ['access-groups'] });
      setEditing(group);
    },
  });

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Groups</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Give the firm&apos;s staff access to companies in bulk. Everyone in a group gets each
              of its companies at the group&apos;s role. In several groups, the highest role wins; a
              membership set directly on a company&apos;s Team page takes precedence.
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="New group name…"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
              Create group
            </Button>
          </form>
        </header>

        {create.error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {create.error instanceof ApiError
              ? create.error.message
              : 'Could not create the group.'}
          </p>
        )}
        {groups.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Group</th>
                <th className="px-4 py-3 text-left font-medium">Members</th>
                <th className="px-4 py-3 text-left font-medium">Companies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.data?.map((g) => (
                <tr
                  key={g.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setEditing(g)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{g.name}</div>
                    {g.description && <div className="text-xs text-slate-500">{g.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{g.members.length}</td>
                  <td className="px-4 py-3">
                    {g.companies.length === 0 ? (
                      <span className="text-xs text-slate-500">none</span>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {g.companies.map((c) => (
                          <li
                            key={c.companyId}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                          >
                            <span className="font-medium">{c.companyName}</span>
                            <span className="text-slate-500"> · {ROLE_LABELS[c.role]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
              {groups.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">
                    No groups yet. Create one, then add people and companies to it.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {editing && people.data && (
        <GroupDrawer
          // Re-mount when switching groups so the drafts reset.
          key={editing.id}
          group={editing}
          people={people.data.users}
          companies={people.data.companies}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function GroupDrawer({
  group,
  people,
  companies,
  onClose,
}: {
  group: AccessGroup;
  people: Array<{ id: number; email: string; roleGlobal: 'super_admin' | 'none' }>;
  companies: Array<{ id: number; name: string; isInternal: boolean }>;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [members, setMembers] = useState<Set<number>>(
    () => new Set(group.members.map((m) => m.userId)),
  );
  const [grants, setGrants] = useState<Map<number, CompanyRole>>(
    () => new Map(group.companies.map((c) => [c.companyId, c.role])),
  );
  const [memberFilter, setMemberFilter] = useState('');

  const sortedPeople = useMemo(() => {
    const needle = memberFilter.trim().toLowerCase();
    return [...people]
      .filter((p) => !needle || p.email.toLowerCase().includes(needle))
      .sort((a, b) => a.email.localeCompare(b.email));
  }, [people, memberFilter]);
  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim() !== group.name || description.trim() !== (group.description ?? '')) {
        await admin.updateAccessGroup(group.id, {
          name: name.trim(),
          description: description.trim() || null,
        });
      }
      await admin.setAccessGroupMembers(group.id, { userIds: [...members] });
      await admin.setAccessGroupCompanies(group.id, {
        companies: [...grants].map(([companyId, role]) => ({ companyId, role })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-groups'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => admin.deleteAccessGroup(group.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-groups'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
  });

  const error = save.error ?? remove.error;

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Group · ${group.name}`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="text-red-700"
            disabled={save.isPending || remove.isPending}
            onClick={() => {
              if (
                confirm(
                  `Delete "${group.name}"? Its ${group.members.length} member(s) lose the company access it grants.`,
                )
              )
                remove.mutate();
            }}
          >
            Delete group
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!name.trim() || remove.isPending}
              loading={save.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <FormField
            label="Name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <FormField
            label="Description"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Companies ({grants.size})</h3>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <tbody className="divide-y divide-slate-100">
              {sortedCompanies.map((c) => {
                const role = grants.get(c.id);
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Grant ${c.name}`}
                        checked={role != null}
                        onChange={(e) => {
                          const next = new Map(grants);
                          if (e.target.checked) next.set(c.id, 'employee');
                          else next.delete(c.id);
                          setGrants(next);
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-900">{c.name}</span>
                      {c.isInternal && <span className="text-xs text-slate-500"> · internal</span>}
                    </td>
                    <td className="py-2">
                      <select
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm disabled:opacity-50"
                        value={role ?? 'employee'}
                        disabled={role == null}
                        onChange={(e) => {
                          const next = new Map(grants);
                          next.set(c.id, e.target.value as CompanyRole);
                          setGrants(next);
                        }}
                      >
                        {Object.entries(ROLE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Members ({members.size})</h3>
            <input
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm"
              placeholder="Filter people…"
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
            />
          </div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {sortedPeople.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Member ${p.email}`}
                  checked={members.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(members);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setMembers(next);
                  }}
                />
                <span className="text-slate-900">{p.email}</span>
                {p.roleGlobal === 'super_admin' && (
                  <span className="text-xs text-slate-500">SuperAdmin — already sees all</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error instanceof ApiError ? error.message : 'Save failed.'}
          </p>
        )}
      </div>
    </Drawer>
  );
}
