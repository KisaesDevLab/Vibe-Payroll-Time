// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import {
  isSignedOutDeliberately,
  peekReturnTo,
  sanitizeReturnTo,
  takeReturnTo,
} from '../lib/return-to';

/**
 * The redirect to sign-in for a page that needs a session. Carries the
 * page in router state so LoginPage can send the person back once they
 * sign in again (a session that expired under them). After a deliberate
 * Sign out it carries nothing.
 */
export function ToLogin() {
  const location = useLocation();
  const returnTo = isSignedOutDeliberately()
    ? null
    : sanitizeReturnTo(`${location.pathname}${location.search}${location.hash}`);
  return <Navigate to="/login" replace state={returnTo ? { returnTo } : undefined} />;
}

/**
 * /login, /firm and /login/local once a session exists: on to the page
 * the person was sent away from, else `/`. This is the one redirect after
 * every sign-in (password, and the single sign-on hand-off that lands on
 * /firm), so LoginPage itself does not navigate. Peeks during render and
 * takes in an effect, so a StrictMode double render can't lose it.
 */
export function SignedInRedirect() {
  const [target] = useState(() => peekReturnTo() ?? '/');
  useEffect(() => {
    takeReturnTo();
  }, []);
  return <Navigate to={target} replace />;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session) return <ToLogin />;
  return <>{children}</>;
}
