import { NavLink } from 'react-router-dom';
import { useSession } from '../hooks/useSession';

export function CompanyTabs({ companyId }: { companyId: number }) {
  const session = useSession();
  const membership = session?.user.memberships.find((m) => m.companyId === companyId);
  const isSuper = session?.user.roleGlobal === 'super_admin';
  const isAdmin = membership?.role === 'company_admin' || isSuper;

  const isSupervisor =
    membership?.role === 'company_admin' ||
    membership?.role === 'supervisor' ||
    isSuper;

  const tabs = [
    { to: `/companies/${companyId}/employees`, label: 'Employees' },
    ...(isSupervisor
      ? [
          { to: `/companies/${companyId}/timesheets`, label: 'Timesheets' },
          { to: `/companies/${companyId}/corrections`, label: 'Corrections' },
        ]
      : []),
    { to: `/companies/${companyId}/jobs`, label: 'Jobs' },
    ...(isAdmin
      ? [
          { to: `/companies/${companyId}/team`, label: 'Team' },
          { to: `/companies/${companyId}/kiosks`, label: 'Kiosks' },
          { to: `/companies/${companyId}/settings`, label: 'Settings' },
        ]
      : []),
  ];

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl gap-1 px-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              'border-b-2 px-4 py-3 text-sm font-medium transition ' +
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
