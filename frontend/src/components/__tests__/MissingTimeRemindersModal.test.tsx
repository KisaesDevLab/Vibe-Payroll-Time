// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MissingTimeReport } from '@vibept/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingTime } from '../../lib/resources';
import { MissingTimeRemindersModal } from '../MissingTimeRemindersModal';

vi.mock('../../lib/resources', () => ({
  missingTime: { report: vi.fn(), remind: vi.fn() },
}));

const report: MissingTimeReport = {
  period: { which: 'previous', start: '2026-10-18', end: '2026-10-24' },
  checkedThrough: '2026-10-24',
  employees: [
    {
      employeeId: 1,
      firstName: 'Ann',
      lastName: 'Able',
      missingDates: ['2026-10-21', '2026-10-22'],
      skipReason: null,
      remindersSent: 0,
      lastRemindedAt: null,
    },
    {
      employeeId: 2,
      firstName: 'Kim',
      lastName: 'Kiosk',
      missingDates: ['2026-10-20'],
      skipReason: 'kiosk_only',
      remindersSent: 0,
      lastRemindedAt: null,
    },
  ],
};

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MissingTimeRemindersModal companyId={3} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('<MissingTimeRemindersModal />', () => {
  it('pre-selects only employees who can be reminded and sends to them', async () => {
    vi.mocked(missingTime.report).mockResolvedValue(report);
    vi.mocked(missingTime.remind).mockResolvedValue({ sent: 1, skipped: [] });
    renderModal();

    expect(await screen.findByText('Able, Ann')).toBeTruthy();
    expect(screen.getByText(/Can.t remind: No sign-in/)).toBeTruthy();
    const send = await screen.findByRole('button', { name: 'Send 1 reminder' });

    fireEvent.click(send);
    await waitFor(() =>
      expect(missingTime.remind).toHaveBeenCalledWith(3, { period: 'previous', employeeIds: [1] }),
    );
    expect(await screen.findByText(/Sent 1 reminder\./)).toBeTruthy();
    // The selection clears so a second click can't resend.
    expect(screen.getByRole('button', { name: 'Send 0 reminders' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('says so when nobody is missing time', async () => {
    vi.mocked(missingTime.report).mockResolvedValue({ ...report, employees: [] });
    renderModal();
    expect(await screen.findByText('Nobody is missing time in this pay period.')).toBeTruthy();
  });
});
