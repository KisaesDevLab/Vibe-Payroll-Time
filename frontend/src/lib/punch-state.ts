// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { CurrentPunchResponse, PunchLocationMode, TimeFormat } from '@vibept/shared';
import type { QueuedPunch } from './offline-queue';

/**
 * What the personal-device punch card renders. A slim copy of
 * CurrentPunchResponse — enough to draw the card and decide which
 * buttons to offer — so the last known state can be kept in this browser
 * and shown on an offline cold start.
 */
export interface PunchView {
  openEntry: { id: number | null; entryType: 'work' | 'break'; startedAt: string } | null;
  shiftStartedAt: string | null;
  lastEndedAt: string | null;
  todayWorkSeconds: number;
  punchLocationMode: PunchLocationMode;
  lunchPromptEnabled: boolean;
}

export function toPunchView(s: CurrentPunchResponse): PunchView {
  return {
    openEntry: s.openEntry
      ? { id: s.openEntry.id, entryType: s.openEntry.entryType, startedAt: s.openEntry.startedAt }
      : null,
    shiftStartedAt: s.shiftStartedAt,
    lastEndedAt: s.lastEndedAt,
    todayWorkSeconds: s.todayWorkSeconds,
    punchLocationMode: s.punchLocationMode,
    lunchPromptEnabled: s.lunchPromptEnabled,
  };
}

export interface StoredPunchView {
  view: PunchView;
  savedAt: string;
  timeFormat?: TimeFormat;
}

const key = (userId: number, companyId: number) => `vibept:last-punch:${userId}:${companyId}`;

export function saveLastPunchView(
  userId: number,
  companyId: number,
  view: PunchView,
  timeFormat?: TimeFormat,
): void {
  try {
    const stored: StoredPunchView = { view, savedAt: new Date().toISOString(), timeFormat };
    localStorage.setItem(key(userId, companyId), JSON.stringify(stored));
  } catch {
    /* storage blocked or full — the live query still works */
  }
}

export function loadLastPunchView(userId: number, companyId: number): StoredPunchView | null {
  try {
    const raw = localStorage.getItem(key(userId, companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPunchView;
    if (!parsed?.view || typeof parsed.savedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Apply punches that are queued but not yet sent on top of a known state,
 * so a queued Clock in shows "Working" (and offers Clock out, not a second
 * Clock in). Items are applied oldest-first. `todayWorkSeconds` is left as
 * the server last reported it.
 */
export function applyQueuedPunches(base: PunchView, queued: QueuedPunch[]): PunchView {
  let v = { ...base };
  for (const q of queued) {
    const at = q.queuedAt;
    switch (q.endpoint) {
      case '/punch/clock-in':
        v = { ...v, openEntry: { id: null, entryType: 'work', startedAt: at }, shiftStartedAt: at };
        break;
      case '/punch/clock-out':
        v = { ...v, openEntry: null, shiftStartedAt: null, lastEndedAt: at };
        break;
      case '/punch/break-in':
        v = {
          ...v,
          openEntry: { id: null, entryType: 'break', startedAt: at },
          shiftStartedAt: v.shiftStartedAt ?? v.openEntry?.startedAt ?? at,
        };
        break;
      case '/punch/break-out':
        v = { ...v, openEntry: { id: null, entryType: 'work', startedAt: at } };
        break;
      default:
        break;
    }
  }
  return v;
}
