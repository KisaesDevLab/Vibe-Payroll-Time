// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { NavLink } from 'react-router-dom';
import { useSession } from '../hooks/useSession';

interface TabUser {
  roleGlobal: string;
  memberships: Array<{ companyId: number; role: string }>;
}

/**
 * True when the user has a manager's role at this company: SuperAdmin,
 * company admin or supervisor. The company pages are theirs; an
 * employee-role member's are /my-punch and /my-timesheet (the backend
 * refuses employees on employees, timesheets, corrections, reports and
 * everything admin-only).
 */
export function canManageCompany(user: TabUser, companyId: number): boolean {
  if (user.roleGlobal === 'super_admin') return true;
  const role = user.memberships.find((m) => m.companyId === companyId)?.role;
  return role === 'company_admin' || role === 'supervisor';
}

export function CompanyTabs({ companyId }: { companyId: number }) {
  const session = useSession();
  const membership = session?.user.memberships.find((m) => m.companyId === companyId);
  const isSuper = session?.user.roleGlobal === 'super_admin';
  const isAdmin = membership?.role === 'company_admin' || isSuper;
  const isSupervisor = !!session && canManageCompany(session.user, companyId);

  // Employees see no tabs at all — CompanyLayout redirects them — but
  // gate each tab on its own role anyway so nothing leaks if it renders.
  const tabs = [
    ...(isSupervisor
      ? [
          { to: `/companies/${companyId}/employees`, label: 'Employees' },
          { to: `/companies/${companyId}/timesheets`, label: 'Timesheets' },
          { to: `/companies/${companyId}/corrections`, label: 'Corrections' },
          { to: `/companies/${companyId}/reports`, label: 'Reports' },
          { to: `/companies/${companyId}/jobs`, label: 'Jobs' },
        ]
      : []),
    ...(isAdmin
      ? [
          { to: `/companies/${companyId}/exports`, label: 'Exports' },
          { to: `/companies/${companyId}/team`, label: 'Team' },
          { to: `/companies/${companyId}/kiosks`, label: 'Kiosks' },
          {
            to: `/companies/${companyId}/notifications-log`,
            label: 'Notifications',
          },
          { to: `/companies/${companyId}/settings`, label: 'Settings' },
        ]
      : []),
  ];

  return (
    <nav className="border-b border-slate-200 bg-white">
      {/* overflow-x-auto + whitespace-nowrap so admin tabs (11 when
          every role is active) scroll horizontally on narrow screens
          instead of wrapping or being clipped off the right edge. */}
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              'shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition sm:px-4 ' +
              (isActive
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
