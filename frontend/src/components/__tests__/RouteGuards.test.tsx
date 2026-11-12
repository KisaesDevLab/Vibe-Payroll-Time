// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthResponse } from '@vibept/shared';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../hooks/useSession';
import { authStore } from '../../lib/auth-store';
import { clearReturnTo, peekReturnTo, takeReturnTo } from '../../lib/return-to';
import { LoginPage } from '../../pages/LoginPage';
import { RequireSession, SignedInRedirect } from '../RouteGuards';
import { TopBar } from '../TopBar';

/**
 * A session that lapses under someone sends them to /login carrying the
 * page they were on, and signing back in returns them there. A
 * deliberate Sign out must leave nothing behind for the next person.
 */

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    // Logout call, magic-link options: all succeed quietly.
    apiFetch: vi.fn().mockResolvedValue({ emailEnabled: false, smsEnabled: false }),
  };
});
vi.mock('../../hooks/useApplianceName', () => ({ useApplianceName: () => 'Vibe PT' }));

const session: AuthResponse = {
  accessToken: 'not-a-jwt',
  accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  refreshToken: 'r1',
  user: {
    id: 7,
    email: 'admin@acme.test',
    roleGlobal: 'none',
    memberships: [
      {
        companyId: 3,
        companyName: 'Acme',
        role: 'company_admin',
        isEmployee: false,
      },
    ],
  } as AuthResponse['user'],
};

function LoginState() {
  const location = useLocation();
  const state = location.state as { returnTo?: string } | null;
  return <p data-testid="login-state">{state?.returnTo ?? 'none'}</p>;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** Same shape as App.tsx's /login route. */
function LoginRoute({ login }: { login: 'probe' | 'real' }) {
  const current = useSession();
  if (current) return <SignedInRedirect />;
  if (login === 'probe') return <LoginState />;
  return (
    <>
      <LoginPage />
      <LoginState />
    </>
  );
}

function renderApp(initial: string, login: 'probe' | 'real' = 'probe') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/login" element={<LoginRoute login={login} />} />
          <Route
            path="/companies/3/reports"
            element={
              <RequireSession>
                <TopBar />
                <Where />
              </RequireSession>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('return to the page after a lapsed session', () => {
  beforeEach(() => {
    takeReturnTo(); // reset any signed-out state from a previous test
    authStore.set(session);
  });
  afterEach(() => {
    authStore.set(null);
    clearReturnTo();
  });

  it('an expired session carries the page to /login', async () => {
    renderApp('/companies/3/reports?week=2026-11-02');
    expect(screen.getByTestId('where')).toHaveTextContent('/companies/3/reports');
    act(() => authStore.set(null));
    await waitFor(() =>
      expect(screen.getByTestId('login-state')).toHaveTextContent(
        '/companies/3/reports?week=2026-11-02',
      ),
    );
  });

  it('LoginPage keeps it, and signing in lands back on the page', async () => {
    renderApp('/companies/3/reports', 'real');
    act(() => authStore.set(null));
    await waitFor(() => expect(peekReturnTo()).toBe('/companies/3/reports'));
    // A password sign-in only stores the session; the route redirects.
    act(() => authStore.set(session));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/companies/3/reports'),
    );
    expect(peekReturnTo()).toBeNull();
  });

  it('a deliberate Sign out leaves no return path', async () => {
    renderApp('/companies/3/reports', 'real');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!);
    await waitFor(() => expect(screen.getByTestId('login-state')).toHaveTextContent('none'));
    expect(authStore.get()).toBeNull();
    expect(peekReturnTo()).toBeNull();
  });
});
