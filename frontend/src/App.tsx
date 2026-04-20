import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './hooks/useSession';
import { useSetupStatus } from './hooks/useSetupStatus';
import { CompaniesListPage } from './pages/CompaniesListPage';
import { CompanyLayout } from './pages/CompanyLayout';
import { CompanySettingsPage } from './pages/CompanySettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { JobsPage } from './pages/JobsPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { TeamPage } from './pages/TeamPage';

function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
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
          <Route path="jobs" element={<JobsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="settings" element={<CompanySettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
