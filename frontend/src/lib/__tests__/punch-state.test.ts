// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import type { QueuedPunch } from '../offline-queue';
import {
  type PunchView,
  applyQueuedPunches,
  loadLastPunchView,
  saveLastPunchView,
} from '../punch-state';

const clockedOut: PunchView = {
  openEntry: null,
  shiftStartedAt: null,
  lastEndedAt: '2026-11-10T22:00:00.000Z',
  todayWorkSeconds: 0,
  punchLocationMode: 'required',
  lunchPromptEnabled: true,
};

const q = (endpoint: string, queuedAt: string): QueuedPunch => ({
  endpoint,
  payload: {},
  queuedAt,
  userId: 1,
  companyId: 2,
});

describe('applyQueuedPunches', () => {
  it('shows a queued clock-in as working, so the card offers Clock out', () => {
    const v = applyQueuedPunches(clockedOut, [q('/punch/clock-in', '2026-11-11T14:00:00.000Z')]);
    expect(v.openEntry).toEqual({
      id: null,
      entryType: 'work',
      startedAt: '2026-11-11T14:00:00.000Z',
    });
    expect(v.shiftStartedAt).toBe('2026-11-11T14:00:00.000Z');
  });

  it('applies a sequence in order', () => {
    const v = applyQueuedPunches(clockedOut, [
      q('/punch/clock-in', '2026-11-11T14:00:00.000Z'),
      q('/punch/break-in', '2026-11-11T16:00:00.000Z'),
    ]);
    expect(v.openEntry?.entryType).toBe('break');
    expect(v.shiftStartedAt).toBe('2026-11-11T14:00:00.000Z');
    const out = applyQueuedPunches(v, [
      q('/punch/break-out', '2026-11-11T16:30:00.000Z'),
      q('/punch/clock-out', '2026-11-11T20:00:00.000Z'),
    ]);
    expect(out.openEntry).toBeNull();
    expect(out.lastEndedAt).toBe('2026-11-11T20:00:00.000Z');
  });
});

describe('last known punch view', () => {
  afterEach(() => localStorage.clear());

  it('round-trips per user and company, keeping the location mode', () => {
    saveLastPunchView(1, 2, clockedOut, 'hhmm');
    expect(loadLastPunchView(1, 2)).toMatchObject({
      view: { punchLocationMode: 'required' },
      timeFormat: 'hhmm',
    });
    expect(loadLastPunchView(1, 3)).toBeNull();
    expect(loadLastPunchView(9, 2)).toBeNull();
  });

  it('ignores garbage', () => {
    localStorage.setItem('vibept:last-punch:1:2', '{not json');
    expect(loadLastPunchView(1, 2)).toBeNull();
  });
});
