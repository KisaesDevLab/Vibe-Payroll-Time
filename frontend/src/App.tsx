// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { OfflineBanner } from './components/OfflineBanner';
import { RequireSession, SignedInRedirect, ToLogin } from './components/RouteGuards';
import { SupportChatWidget } from './components/SupportChatWidget';
import { useSession } from './hooks/useSession';
import { useSetupStatus } from './hooks/useSetupStatus';
import { CompanyLayout } from './pages/CompanyLayout';
import { DashboardPage } from './pages/DashboardPage';
import { KioskPairPage } from './pages/kiosk/KioskPairPage';
import { KioskRoot } from './pages/kiosk/KioskRoot';
import { isPunchOnlyUser } from './lib/punch-only';
import { LoginPage } from './pages/LoginPage';
import { MagicLinkConsumePage } from './pages/MagicLinkConsumePage';
import { MyPunchPage } from './pages/MyPunchPage';
import { MyTimesheetPage } from './pages/MyTimesheetPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage';
import { PreferencesPage } from './pages/PreferencesPage';

/**
 * Admin, settings, report and grid pages load on demand, so an employee
 * opening the punch page (often on cellular, through a tunnel) downloads
 * only what that page needs. Employee and kiosk pages stay in the main
 * bundle: they must work offline, and the service worker only caches a
 * chunk once it has been fetched.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const AccessGroupsPage = lazyPage(() => import('./pages/AccessGroupsPage'), 'AccessGroupsPage');
const AllUsersPage = lazyPage(() => import('./pages/AllUsersPage'), 'AllUsersPage');
const ApplianceHealthPage = lazyPage(
  () => import('./pages/ApplianceHealthPage'),
  'ApplianceHealthPage',
);
const ApplianceSettingsPage = lazyPage(
  () => import('./pages/ApplianceSettingsPage'),
  'ApplianceSettingsPage',
);
const AuthenticationSettingsPage = lazyPage(
  () => import('./pages/AuthenticationSettingsPage'),
  'AuthenticationSettingsPage',
);
const CompaniesListPage = lazyPage(() => import('./pages/CompaniesListPage'), 'CompaniesListPage');
const CompanySettingsPage = lazyPage(
  () => import('./pages/CompanySettingsPage'),
  'CompanySettingsPage',
);
const CorrectionsPage = lazyPage(() => import('./pages/CorrectionsPage'), 'CorrectionsPage');
const EmployeesPage = lazyPage(() => import('./pages/EmployeesPage'), 'EmployeesPage');
const JobsPage = lazyPage(() => import('./pages/JobsPage'), 'JobsPage');
const KiosksPage = lazyPage(() => import('./pages/KiosksPage'), 'KiosksPage');
const NotificationsLogPage = lazyPage(
  () => import('./pages/NotificationsLogPage'),
  'NotificationsLogPage',
);
const PayrollExportsPage = lazyPage(
  () => import('./pages/PayrollExportsPage'),
  'PayrollExportsPage',
);
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const SetupPage = lazyPage(() => import('./pages/SetupPage'), 'SetupPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const MultiEmployeeGridPage = lazyPage(
  () => import('./pages/MultiEmployeeGridPage'),
  'MultiEmployeeGridPage',
);
const TimesheetsReviewPage = lazyPage(
  () => import('./pages/TimesheetsReviewPage'),
  'TimesheetsReviewPage',
);
// Also the employee's own week grid (/my-timesheet/week): grid editing
// needs the network anyway, so it stays lazy; the list view
// (MyTimesheetPage) is the one that must work offline.
const WeeklyGridPage = lazyPage(() => import('./pages/WeeklyGridPage'), 'WeeklyGridPage');

/** `/kiosk` and `/kiosk/...` — a shared tablet, not a person's session. */
function isKioskPath(pathname: string): boolean {
  return pathname === '/kiosk' || pathname.startsWith('/kiosk/');
}

function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const kiosk = isKioskPath(pathname);
  return (
    <div className="min-h-screen bg-slate-50">
      <Suspense fallback={<p className="px-6 py-8 text-sm text-slate-500">Loading…</p>}>
        {children}
      </Suspense>
      {/* Neither personal-session widget belongs on the kiosk: it has no
          user session and no punch queue (it shows its own offline
          screen), and a floating chat button on a shared punch screen is
          just something to mis-tap. OfflineBanner hides itself there. */}
      <OfflineBanner />
      {!kiosk && <SupportChatWidget />}
    </div>
  );
}

/**
 * `/` — the dashboard for anyone who manages a company; straight to the
 * clock for someone whose only job here is to punch (no SuperAdmin, no
 * admin or supervisor role anywhere, and an employee record somewhere).
 * Sign-in lands on `/`, so this is also where employees start.
 *
 *   - employee-only            → /my-punch
 *   - admin/supervisor (+ employee somewhere) → dashboard; My time is in
 *     the top bar, and the company card links to it
 *   - no memberships (not SuperAdmin) → dashboard, which says to ask an
 *     administrator for access
 */
function HomeRoute() {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (isPunchOnlyUser(session.user)) return <Navigate to="/my-punch" replace />;
  return <DashboardPage />;
}

function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <ToLogin />;
  if (session.user.roleGlobal !== 'super_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const setupStatus = useSetupStatus();
  const session = useSession();

  // Kiosk routes render ahead of setup/session gating — a shared-device
  // kiosk shouldn't depend on a user session, and pairing is the device's
  // whole reason for being. They still call the backend which rejects if
  // setup hasn't run, and the KioskPairPage surfaces that error.
  if (setupStatus.isPending) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          loading…
        </div>
      </AppShell>
    );
  }

  // Only fall back when there's no answer at all: a remembered setup
  // status (useSetupStatus) lets an offline phone reach its punch page.
  if (setupStatus.isError && !setupStatus.data) {
    return (
      <AppShell>
        <Routes>
          <Route path="/kiosk/pair" element={<KioskPairPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </AppShell>
    );
  }

  if (setupStatus.data?.setupRequired) {
    return (
      <AppShell>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/login" element={session ? <SignedInRedirect /> : <LoginPage />} />
        {/* The firm's staff sign-in (single sign-on). Kept off /login so
            client-company users never see the identity-provider button. */}
        <Route
          path="/firm"
          element={session ? <SignedInRedirect /> : <LoginPage variant="firm" />}
        />
        {/* Break-glass: the password form even when the firm has gone
            SSO-only. Unlisted on purpose — the appliance prints the URL
            alongside the break-glass credentials. */}
        <Route
          path="/login/local"
          element={session ? <SignedInRedirect /> : <LoginPage variant="breakglass" />}
        />
        {/* Magic-link callback. Must run unauthenticated — the whole
            point is to MINT a session. Even if the user already has
            one, hit consume so the new token rotates them in. */}
        <Route path="/auth/magic" element={<MagicLinkConsumePage />} />
        {/* Password-reset callback. Same token exchange as /auth/magic,
            but requires a new password before releasing the user into
            the app — see ResetPasswordPage. Also unauthenticated for
            the same reason. */}
        <Route path="/auth/reset" element={<ResetPasswordPage />} />
        <Route path="/setup" element={<Navigate to="/" replace />} />

        <Route path="/kiosk" element={<KioskRoot />} />
        <Route path="/kiosk/pair" element={<KioskPairPage />} />

        <Route
          path="/my-punch"
          element={
            <RequireSession>
              <MyPunchPage />
            </RequireSession>
          }
        />
        <Route
          path="/my-timesheet"
          element={
            <RequireSession>
              <MyTimesheetPage />
            </RequireSession>
          }
        />
        {/* The employee's own week grid. Outside CompanyLayout (whose
            tabs are admin pages); WeeklyGridPage reads the company from
            usePunchCompany when there is no :companyId in the route. */}
        <Route
          path="/my-timesheet/week"
          element={
            <RequireSession>
              <WeeklyGridPage />
            </RequireSession>
          }
        />
        <Route
          path="/notifications"
          element={
            <RequireSession>
              <NotificationPreferencesPage />
            </RequireSession>
          }
        />
        <Route
          path="/preferences"
          element={
            <RequireSession>
              <PreferencesPage />
            </RequireSession>
          }
        />

        <Route path="/" element={<HomeRoute />} />

        <Route
          path="/companies"
          element={
            <RequireSuperAdmin>
              <CompaniesListPage />
            </RequireSuperAdmin>
          }
        />

        <Route
          path="/appliance"
          element={
            <RequireSuperAdmin>
              <ApplianceHealthPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/appliance/settings"
          element={
            <RequireSuperAdmin>
              <ApplianceSettingsPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/appliance/authentication"
          element={
            <RequireSuperAdmin>
              <AuthenticationSettingsPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/appliance/users"
          element={
            <RequireSuperAdmin>
              <AllUsersPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/appliance/groups"
          element={
            <RequireSuperAdmin>
              <AccessGroupsPage />
            </RequireSuperAdmin>
          }
        />

        <Route
          path="/companies/:companyId"
          element={
            <RequireSession>
              <CompanyLayout />
            </RequireSession>
          }
        >
          <Route index element={<Navigate to="employees" replace />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="timesheets/:employeeId/week" element={<WeeklyGridPage />} />
          <Route path="timesheets/grid" element={<MultiEmployeeGridPage />} />
          <Route path="timesheets" element={<TimesheetsReviewPage />} />
          <Route path="corrections" element={<CorrectionsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="exports" element={<PayrollExportsPage />} />
          <Route path="notifications-log" element={<NotificationsLogPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="kiosks" element={<KiosksPage />} />
          <Route path="settings" element={<CompanySettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
