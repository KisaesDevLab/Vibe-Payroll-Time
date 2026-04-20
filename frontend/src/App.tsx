import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBanner } from './components/OfflineBanner';
import { SupportChatWidget } from './components/SupportChatWidget';
import { useSession } from './hooks/useSession';
import { useSetupStatus } from './hooks/useSetupStatus';
import { CompaniesListPage } from './pages/CompaniesListPage';
import { CompanyLayout } from './pages/CompanyLayout';
import { CompanySettingsPage } from './pages/CompanySettingsPage';
import { CorrectionsPage } from './pages/CorrectionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { JobsPage } from './pages/JobsPage';
import { KiosksPage } from './pages/KiosksPage';
import { KioskPairPage } from './pages/kiosk/KioskPairPage';
import { KioskRoot } from './pages/kiosk/KioskRoot';
import { LoginPage } from './pages/LoginPage';
import { MyPunchPage } from './pages/MyPunchPage';
import { MyTimesheetPage } from './pages/MyTimesheetPage';
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage';
import { NotificationsLogPage } from './pages/NotificationsLogPage';
import { PayrollExportsPage } from './pages/PayrollExportsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SetupPage } from './pages/SetupPage';
import { TeamPage } from './pages/TeamPage';
import { TimesheetsReviewPage } from './pages/TimesheetsReviewPage';

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      {children}
      <OfflineBanner />
      <SupportChatWidget />
    </div>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
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

  if (setupStatus.isError) {
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
        <Route
          path="/login"
          element={session ? <Navigate to="/" replace /> : <LoginPage />}
        />
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
        <Route
          path="/notifications"
          element={
            <RequireSession>
              <NotificationPreferencesPage />
            </RequireSession>
          }
        />

        <Route
          path="/"
          element={
            <RequireSession>
              <DashboardPage />
            </RequireSession>
          }
        />

        <Route
          path="/companies"
          element={
            <RequireSuperAdmin>
              <CompaniesListPage />
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
