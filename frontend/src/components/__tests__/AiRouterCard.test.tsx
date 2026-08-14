// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AiRouterHealth } from '../../lib/resources';
import { AiRouterCard } from '../AiRouterCard';

const base: AiRouterHealth['registration'] = {
  status: 'disabled',
  attempts: 0,
  lastAttemptAt: null,
  registeredAt: null,
  lastError: null,
  nextRetryInMs: null,
};

describe('<AiRouterCard />', () => {
  it('renders a muted note in direct mode', () => {
    render(<AiRouterCard aiRouter={{ mode: 'direct', registration: base }} />);
    expect(screen.getByText(/router not in use/i)).toBeTruthy();
  });

  it('renders registering state with attempt count while pending', () => {
    render(
      <AiRouterCard
        aiRouter={{
          mode: 'router',
          registration: { ...base, status: 'pending', attempts: 1 },
        }}
      />,
    );
    expect(screen.getByText(/registering/i)).toBeTruthy();
    expect(screen.getByText(/attempt 1/i)).toBeTruthy();
  });

  it('renders registered state with the registration time', () => {
    render(
      <AiRouterCard
        aiRouter={{
          mode: 'router',
          registration: {
            ...base,
            status: 'registered',
            attempts: 1,
            registeredAt: '2026-08-09T12:00:00.000Z',
          },
        }}
      />,
    );
    expect(screen.getByText('registered')).toBeTruthy();
    expect(screen.getByText(/since/i)).toBeTruthy();
  });

  it('shows the token-identity hint for an auth failure (403)', () => {
    render(
      <AiRouterCard
        aiRouter={{
          mode: 'router',
          registration: {
            ...base,
            status: 'failing',
            attempts: 4,
            lastAttemptAt: '2026-08-09T12:00:00.000Z',
            lastError: { status: 403, code: 'auth_error', message: 'token identity mismatch' },
            nextRetryInMs: 300_000,
          },
        }}
      />,
    );
    expect(screen.getByText(/registration failing/i)).toBeTruthy();
    expect(screen.getByText(/HTTP 403 — auth_error: token identity mismatch/)).toBeTruthy();
    expect(screen.getByText(/must be minted for/i)).toBeTruthy();
  });

  it('does NOT show the token-identity hint for non-auth failures', () => {
    render(
      <AiRouterCard
        aiRouter={{
          mode: 'router',
          registration: {
            ...base,
            status: 'failing',
            attempts: 2,
            lastAttemptAt: '2026-08-09T12:00:00.000Z',
            lastError: { status: null, code: null, message: 'ECONNREFUSED' },
            nextRetryInMs: 10_000,
          },
        }}
      />,
    );
    expect(screen.getByText(/registration failing/i)).toBeTruthy();
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    expect(screen.queryByText(/must be minted for/i)).toBeNull();
  });
});
