// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { PassThrough } from 'node:stream';
import type { ReportColumn } from '@vibept/shared';
import { describe, expect, it } from 'vitest';
import { streamCsv } from '../csv-stream.js';

async function toCsv(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
): Promise<string> {
  const out = new PassThrough();
  let text = '';
  out.on('data', (chunk) => (text += String(chunk)));
  async function* gen() {
    yield* rows;
  }
  await streamCsv(columns, gen(), out);
  return text;
}

describe('streamCsv', () => {
  it('leaves blank date cells blank on a summary row instead of throwing', async () => {
    // The time card's TOTAL row carries date: '' — new Date('') used to
    // throw in toISOString() and cut the download short.
    const csv = await toCsv(
      [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'type', label: 'Type', type: 'string' },
        { key: 'startedAt', label: 'Start', type: 'datetime' },
        { key: 'durationSeconds', label: 'Hours', type: 'hours' },
      ],
      [
        {
          date: '2026-10-19',
          type: 'work',
          startedAt: '2026-10-19T14:00:00.000Z',
          durationSeconds: 32400,
        },
        { date: '', type: 'TOTAL', startedAt: '', durationSeconds: 32400 },
      ],
    );
    expect(csv.trim().split('\r\n')).toEqual([
      'Date,Type,Start,Hours',
      '2026-10-19,work,2026-10-19T14:00:00.000Z,9.00',
      ',TOTAL,,9.00',
    ]);
  });
});
