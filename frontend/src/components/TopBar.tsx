import { Link, useNavigate } from 'react-router-dom';
import { useApplianceName } from '../hooks/useApplianceName';
import { useSession } from '../hooks/useSession';
import { apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { Button } from './Button';

export function TopBar() {
  const session = useSession();
  const navigate = useNavigate();
  const applianceName = useApplianceName();

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session?.refreshToken }),
      });
    } catch {
      /* ignore; clear local state regardless */
    }
    authStore.set(null);
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        <Link to="/" className="text-sm font-semibold tracking-tight text-slate-900">
          {applianceName}
        </Link>

        <nav className="hidden items-center gap-4 text-sm text-slate-600 md:flex">
          <Link to="/" className="hover:text-slate-900">
            Dashboard
          </Link>
          {session && session.user.memberships.length > 0 && (
            <>
              {session.user.memberships.some((m) => m.isEmployee) && (
                <>
                  {/* Only show personal-punch + timesheet links when
                      the user has an active employee record somewhere.
                      A SuperAdmin-only account (no employee rows) sees
                      neither because clicking them would just hit a
                      403. */}
                  <Link to="/my-punch" className="hover:text-slate-900">
                    My time
                  </Link>
                  <Link to="/my-timesheet" className="hover:text-slate-900">
                    Timesheet
                  </Link>
                </>
              )}
              <Link to="/notifications" className="hover:text-slate-900">
                Notifications
              </Link>
            </>
          )}
          {session?.user.roleGlobal === 'super_admin' && (
            <>
              <Link to="/companies" className="hover:text-slate-900">
                All companies
              </Link>
              <Link to="/appliance/users" className="hover:text-slate-900">
                People
              </Link>
              <Link to="/appliance" className="hover:text-slate-900">
                Appliance
              </Link>
            </>
          )}
        </nav>

        {session ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">{session.user.email}</span>
            {session.user.roleGlobal === 'super_admin' && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                SuperAdmin
              </span>
            )}
            <Link to="/preferences" className="text-slate-600 hover:text-slate-900">
              Preferences
            </Link>
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        ) : (
          <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
