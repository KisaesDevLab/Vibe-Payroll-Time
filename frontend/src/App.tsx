import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './hooks/useSession';
import { useSetupStatus } from './hooks/useSetupStatus';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
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

  // If backend is unreachable, still render the login page so users can see
  // an actionable error instead of a blank screen.
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
              <HomePage />
            </RequireSession>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
