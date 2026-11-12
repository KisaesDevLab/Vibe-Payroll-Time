// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SetupStatusResponse } from '@vibept/shared';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startSkewLoop } from './lib/clock-skew';
import { startQueueFlusher } from './lib/offline-queue';
import { refreshSessionUser } from './lib/refresh-session-user';
import { consumeSsoHandoff } from './lib/sso';
import { registerServiceWorker } from './lib/sw';
import './index.css';

registerServiceWorker();
startSkewLoop();
startQueueFlusher();
// Refresh the cached `session.user` (memberships, isEmployee, etc.)
// from /auth/me on every app boot so a tab that logged in before a
// server-side link change (employees.user_id backfill, role edit,
// membership added) self-corrects on the next page load without
// requiring the user to sign out. Fire-and-forget — failures fall
// back to the cached session.
//
// A single sign-on redirect lands here with the session on the URL
// fragment. It is consumed FIRST and awaited before the first render, so
// the router sees a signed-in session instead of flashing the login form
// (no fragment, no wait — this resolves immediately).
const booted = consumeSsoHandoff().then(() => void refreshSessionUser());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// Offline cold start: /setup/status can't load, and App gates every
// route on it. Once this browser has seen a finished setup, seed that
// answer (marked stale, so it is re-checked whenever the network allows)
// so a phone in a basement still reaches the punch page and a kiosk still
// boots. Setup can't be undone, so the seed can't be wrong in a way that
// matters.
const SETUP_DONE_KEY = 'vibept.setup-complete';
try {
  const installationId = localStorage.getItem(SETUP_DONE_KEY);
  if (installationId !== null) {
    queryClient.setQueryData<SetupStatusResponse>(
      ['setup-status'],
      { setupRequired: false, installationId: installationId || null },
      { updatedAt: 0 },
    );
  }
} catch {
  /* storage blocked — no seed, the live check still runs */
}
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.query.queryKey[0] !== 'setup-status') return;
  const data = event.query.state.data as SetupStatusResponse | undefined;
  if (data && !data.setupRequired) {
    try {
      localStorage.setItem(SETUP_DONE_KEY, data.installationId ?? '');
    } catch {
      /* ignore */
    }
  }
});

const container = document.getElementById('root');
if (!container) throw new Error('root element not found');

// Strip trailing slash from Vite's BASE_URL — react-router's basename
// expects a path without one. `/` (single-app default) becomes ``, which
// react-router treats as no basename. `/payroll/` (multi-app overlay)
// becomes `/payroll`, so route paths like `/dashboard` continue to match
// against the substring after the prefix.
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '');

const root = ReactDOM.createRoot(container);
void booted.finally(() =>
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={routerBasename}>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  ),
);
