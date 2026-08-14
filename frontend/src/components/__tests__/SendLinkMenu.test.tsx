// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SendAccountLinkResponse } from '@vibept/shared';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendLinkMenu } from '../SendLinkMenu';

/**
 * The behavior worth pinning down here is the outcome reporting. The
 * notification dispatcher can return HTTP 200 while skipping the actual
 * send (no phone on file, provider unconfigured for the company), and
 * rendering that as a cheerful "Sent!" is exactly how an admin ends up
 * telling a new hire to watch a phone that will never buzz.
 */

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    // Channel availability — both transports configured, so all four
    // menu actions are live.
    apiFetch: vi.fn().mockResolvedValue({ emailEnabled: true, smsEnabled: true }),
  };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/**
 * Open the menu and click one action.
 *
 * Menu items start disabled and only enable once the channel-options
 * query resolves, so clicking the moment the element exists is a no-op
 * — the same thing a fast-fingered user would hit. Wait for enablement
 * first.
 */
async function pick(action: string) {
  fireEvent.click(screen.getByRole('button', { name: /send link/i }));
  const item = (await screen.findByText(action)) as HTMLButtonElement;
  await waitFor(() => expect(item.disabled).toBe(false));
  fireEvent.click(item);
}

const sent: SendAccountLinkResponse = {
  channel: 'email',
  purpose: 'login',
  sentTo: 'j••@example.com',
  status: 'sent',
  error: null,
  phoneUnverified: false,
};

afterEach(() => vi.clearAllMocks());

describe('<SendLinkMenu />', () => {
  it('reports a successful send with the masked address', async () => {
    const send = vi.fn().mockResolvedValue(sent);
    wrap(<SendLinkMenu send={send} />);

    await pick('Email a sign-in link');

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/Sign-in link sent/),
    );
    expect(screen.getByRole('status').textContent).toContain('j••@example.com');
    // TanStack Query v5 hands the mutationFn a second context argument
    // ({ client, meta, signal }), so assert on the variables only.
    expect(send.mock.calls[0]?.[0]).toEqual({ channel: 'email', purpose: 'login' });
  });

  it('surfaces a skipped send as a warning with the reason, not a success', async () => {
    const send = vi.fn().mockResolvedValue({
      ...sent,
      channel: 'sms',
      status: 'skipped',
      error: 'phone not verified',
    } satisfies SendAccountLinkResponse);
    wrap(<SendLinkMenu send={send} />);

    await pick('Text a sign-in link');

    const status = await screen.findByRole('status');
    await waitFor(() => expect(status.textContent).toMatch(/Not sent \(skipped\)/));
    expect(status.textContent).toContain('phone not verified');
    expect(status.textContent).not.toMatch(/\bsent to\b/);
  });

  it('sends a password reset when that action is picked', async () => {
    const send = vi.fn().mockResolvedValue({ ...sent, purpose: 'password_reset' });
    wrap(<SendLinkMenu send={send} />);

    await pick('Email a password reset');

    await waitFor(() =>
      expect(send.mock.calls[0]?.[0]).toEqual({ channel: 'email', purpose: 'password_reset' }),
    );
    expect((await screen.findByRole('status')).textContent).toMatch(/Password reset sent/);
  });
});
