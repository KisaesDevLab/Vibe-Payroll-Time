// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApplianceName } from '../hooks/useApplianceName';
import { useSession } from '../hooks/useSession';
import { apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { Button } from './Button';

/**
 * Top navigation bar.
 *
 * On wide viewports (≥ 768 px) the full nav is rendered inline on the
 * right of the logo. On narrow viewports the inline nav is hidden and
 * a hamburger button in its place reveals a full-width slide-down
 * menu with the same set of links. Without this mobile path an
 * employee opening the app on their phone would see only the logo,
 * Preferences, and Sign-out — with no way to reach "My time",
 * "Timesheet", or "Notifications".
 *
 * The menu closes on any navigation (tap a link) or on route change
 * from any other source (back button, external redirect). It also
 * exposes all of the right-side actions (Preferences, Sign out, plus
 * the user's email for reference) so nothing desktop users can do is
 * off-limits to mobile users.
 */
export function TopBar() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const applianceName = useApplianceName();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu whenever the route changes so tapping a link
  // always collapses it.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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

  const isEmployee = !!session?.user.memberships.some((m) => m.isEmployee);
  const hasMemberships = !!session && session.user.memberships.length > 0;
  const isSuper = session?.user.roleGlobal === 'super_admin';

  // Shared link list used by both desktop + mobile so they never drift
  // out of sync. Each entry is gated on the same visibility rules that
  // already drove the desktop-only nav.
  const links: Array<{ to: string; label: string }> = [{ to: '/', label: 'Dashboard' }];
  if (hasMemberships) {
    if (isEmployee) {
      links.push({ to: '/my-punch', label: 'My time' });
      links.push({ to: '/my-timesheet', label: 'Timesheet' });
    }
    links.push({ to: '/notifications', label: 'Notifications' });
  }
  if (isSuper) {
    links.push({ to: '/companies', label: 'All companies' });
    links.push({ to: '/appliance/users', label: 'People' });
    links.push({ to: '/appliance', label: 'Appliance' });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="text-sm font-semibold tracking-tight text-slate-900">
          {applianceName}
        </Link>

        {/* Desktop inline nav — hidden below md */}
        <nav className="hidden items-center gap-4 text-sm text-slate-600 md:flex">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-slate-900">
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right-side actions */}
        {session ? (
          <div className="hidden items-center gap-3 text-sm md:flex">
            <span className="hidden text-slate-600 sm:inline">{session.user.email}</span>
            {isSuper && (
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
          <Link to="/login" className="hidden text-sm text-slate-600 hover:text-slate-900 md:block">
            Sign in
          </Link>
        )}

        {/* Mobile: hamburger (or Sign-in when logged out). 44×44 hit
            target meets iOS / Android accessibility guidelines. */}
        {session ? (
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 md:hidden"
          >
            {menuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        ) : (
          <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900 md:hidden">
            Sign in
          </Link>
        )}
      </div>

      {/* Mobile panel — rendered under the bar when menuOpen is true.
          Stacks links vertically with generous touch targets. */}
      {session && menuOpen && (
        <div id="mobile-nav" className="border-t border-slate-200 bg-white md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-4 py-2 text-sm text-slate-700">
            <div className="flex items-center justify-between py-2 text-xs text-slate-500">
              <span className="truncate">{session.user.email}</span>
              {isSuper && (
                <span className="ml-2 shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  SuperAdmin
                </span>
              )}
            </div>
            <nav className="flex flex-col divide-y divide-slate-100">
              {links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className="-mx-4 px-4 py-3 text-base font-medium text-slate-800 hover:bg-slate-50"
                >
                  {l.label}
                </Link>
              ))}
              <Link
                to="/preferences"
                className="-mx-4 px-4 py-3 text-base font-medium text-slate-800 hover:bg-slate-50"
              >
                Preferences
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="-mx-4 px-4 py-3 text-left text-base font-medium text-red-700 hover:bg-red-50"
              >
                Sign out
              </button>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
