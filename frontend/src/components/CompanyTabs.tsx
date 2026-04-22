// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { NavLink } from 'react-router-dom';
import { useSession } from '../hooks/useSession';

export function CompanyTabs({ companyId }: { companyId: number }) {
  const session = useSession();
  const membership = session?.user.memberships.find((m) => m.companyId === companyId);
  const isSuper = session?.user.roleGlobal === 'super_admin';
  const isAdmin = membership?.role === 'company_admin' || isSuper;

  const isSupervisor =
    membership?.role === 'company_admin' || membership?.role === 'supervisor' || isSuper;

  const tabs = [
    { to: `/companies/${companyId}/employees`, label: 'Employees' },
    ...(isSupervisor
      ? [
          { to: `/companies/${companyId}/timesheets`, label: 'Timesheets' },
          { to: `/companies/${companyId}/corrections`, label: 'Corrections' },
          { to: `/companies/${companyId}/reports`, label: 'Reports' },
        ]
      : []),
    { to: `/companies/${companyId}/jobs`, label: 'Jobs' },
    ...(isAdmin
      ? [
          { to: `/companies/${companyId}/exports`, label: 'Exports' },
          { to: `/companies/${companyId}/team`, label: 'Team' },
          { to: `/companies/${companyId}/kiosks`, label: 'Kiosks' },
          {
            to: `/companies/${companyId}/notifications-log`,
            label: 'Notifications',
          },
          { to: `/companies/${companyId}/license`, label: 'License' },
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
