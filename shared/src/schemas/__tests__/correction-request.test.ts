// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createCorrectionRequestSchema } from '../timesheets.js';

const base = { reason: 'Forgot to clock out' };

describe('createCorrectionRequestSchema', () => {
  it('accepts an edit with known fields', () => {
    const r = createCorrectionRequestSchema.safeParse({
      ...base,
      timeEntryId: 5,
      requestType: 'edit',
      proposedChanges: { endedAt: '2026-11-10T23:00:00.000Z' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown or empty edit proposals', () => {
    for (const proposedChanges of [
      {},
      { approvedAt: '2026-11-10T23:00:00.000Z' },
      { endedAt: 'soon' },
    ]) {
      const r = createCorrectionRequestSchema.safeParse({
        ...base,
        timeEntryId: 5,
        requestType: 'edit',
        proposedChanges,
      });
      expect(r.success).toBe(false);
    }
  });

  it('requires a complete entry for add and an entry id for edit/delete', () => {
    expect(
      createCorrectionRequestSchema.safeParse({
        ...base,
        requestType: 'add',
        proposedChanges: { startedAt: '2026-11-10T15:00:00.000Z' },
      }).success,
    ).toBe(false);
    expect(
      createCorrectionRequestSchema.safeParse({
        ...base,
        requestType: 'delete',
        proposedChanges: {},
      }).success,
    ).toBe(false);
    expect(
      createCorrectionRequestSchema.safeParse({
        ...base,
        timeEntryId: 5,
        requestType: 'delete',
        proposedChanges: {},
      }).success,
    ).toBe(true);
  });
});
