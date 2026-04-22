// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { startSkewLoop } from './lib/clock-skew';
import { startQueueFlusher } from './lib/offline-queue';
import { refreshSessionUser } from './lib/refresh-session-user';
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
void refreshSessionUser();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('root element not found');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
