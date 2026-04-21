import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PayrollExport, PayrollFormat } from '@vibept/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../../http/errors.js';
import { genericCsv } from './generic-csv.js';
import { gusto } from './gusto.js';
import { payrollRelief } from './payroll-relief.js';
import { qboPayroll } from './qbo-payroll.js';
import { collectEmployeeSummaries, runPreflight } from './preflight.js';
import type { FormatFn } from './types.js';

const FORMATS: Record<PayrollFormat, FormatFn> = {
  payroll_relief: payrollRelief,
  gusto,
  qbo_payroll: qboPayroll,
  generic_csv: genericCsv,
};

interface PayrollExportRow {
  id: number;
  company_id: number;
  exported_by: number | null;
  period_start: Date;
  period_end: Date;
  format: PayrollFormat;
  file_path: string;
  file_hash: string;
  file_bytes: string | number;
  employee_count: number;
  total_work_seconds: string | number;
  replaced_by_id: number | null;
  notes: string | null;
  exported_at: Date;
}

function rowToExport(row: PayrollExportRow, exportedByEmail: string | null): PayrollExport {
  return {
    id: row.id,
    companyId: row.company_id,
    exportedByEmail,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    format: row.format,
    fileBytes: Number(row.file_bytes),
    fileHash: row.file_hash,
    employeeCount: row.employee_count,
    totalWorkSeconds: Number(row.total_work_seconds),
    replacedById: row.replaced_by_id,
    notes: row.notes,
    exportedAt: row.exported_at.toISOString(),
  };
}

async function ensureExportsDir(companyId: number): Promise<string> {
  const dir = path.resolve(env.EXPORTS_DIR, String(companyId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export interface RunExportOpts {
  companyId: number;
  companyName: string;
  periodStart: Date;
  periodEnd: Date;
  format: PayrollFormat;
  actorUserId: number;
  acknowledgeReExport: boolean;
  notes?: string | undefined;
  genericColumns?: string[] | undefined;
  genericTimeFormat?: 'decimal' | 'hhmm' | undefined;
}

/**
 * Build the CSV, hash it, persist it to disk, insert the metadata row,
 * and link any prior row for the same (company, period, format) to the
 * new one via `replaced_by_id`.
 *
 * Caller is responsible for having consulted preflight first — the run
 * still re-checks so a stale UI can't bypass the "no open entries" rule.
 */
export async function runExport(opts: RunExportOpts): Promise<PayrollExport> {
  const preflight = await runPreflight(opts.companyId, opts.periodStart, opts.periodEnd);
  if (!preflight.ready) {
    throw BadRequest(`Preflight failed: ${preflight.blockingIssues.join('; ')}`, {
      issues: preflight.blockingIssues,
    });
  }

  const prior = await db('payroll_exports')
    .where({
      company_id: opts.companyId,
      format: opts.format,
      period_start: opts.periodStart,
      period_end: opts.periodEnd,
    })
    .whereNull('replaced_by_id')
    .orderBy('exported_at', 'desc')
    .first<{ id: number }>();

  if (prior && !opts.acknowledgeReExport) {
    throw Conflict(
      'This period has already been exported in this format. Set acknowledgeReExport=true to continue.',
      { priorExportId: prior.id },
    );
  }

  const employees = await collectEmployeeSummaries(
    opts.companyId,
    opts.periodStart,
    opts.periodEnd,
  );
  const fmt = FORMATS[opts.format];
  if (!fmt) throw BadRequest(`Unknown format: ${opts.format}`);
  const csv = fmt({
    companyId: opts.companyId,
    companyName: opts.companyName,
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    employees,
    ...(opts.genericColumns ? { genericColumns: opts.genericColumns } : {}),
    ...(opts.genericTimeFormat ? { genericTimeFormat: opts.genericTimeFormat } : {}),
  });

  const hash = crypto.createHash('sha256').update(csv, 'utf8').digest('hex');
  const fileName = `${opts.format}-${opts.periodStart.toISOString().slice(0, 10)}-${hash.slice(0, 12)}.csv`;
  const dir = await ensureExportsDir(opts.companyId);
  const absolutePath = path.join(dir, fileName);
  await fs.writeFile(absolutePath, csv, { encoding: 'utf8', mode: 0o600 });
  const bytes = Buffer.byteLength(csv, 'utf8');

  const totalWorkSeconds = employees.reduce((s, e) => s + e.workSeconds, 0);

  return db.transaction(async (trx) => {
    const [inserted] = await trx<PayrollExportRow>('payroll_exports')
      .insert({
        company_id: opts.companyId,
        exported_by: opts.actorUserId,
        period_start: opts.periodStart,
        period_end: opts.periodEnd,
        format: opts.format,
        file_path: path.posix.join(String(opts.companyId), fileName),
        file_hash: hash,
        file_bytes: bytes,
        employee_count: employees.filter((e) => e.workSeconds > 0).length,
        total_work_seconds: totalWorkSeconds,
        notes: opts.notes ?? null,
      })
      .returning('*');
    if (!inserted) throw new Error('export insert returned no row');

    if (prior) {
      await trx('payroll_exports').where({ id: prior.id }).update({ replaced_by_id: inserted.id });
    }

    const actor = await trx('users').where({ id: opts.actorUserId }).first<{ email: string }>();

    return rowToExport(inserted, actor?.email ?? null);
  });
}

// ---------------------------------------------------------------------------
// History + download
// ---------------------------------------------------------------------------

export async function listExports(companyId: number): Promise<PayrollExport[]> {
  const rows = await db('payroll_exports as p')
    .leftJoin('users as u', 'u.id', 'p.exported_by')
    .where({ 'p.company_id': companyId })
    .orderBy('p.exported_at', 'desc')
    .select<Array<PayrollExportRow & { email: string | null }>>('p.*', 'u.email as email');
  return rows.map((r) => rowToExport(r, r.email));
}

/** Resolve an export row's file on disk. Returns null if the file is
 *  missing (disk pruning, drive failure, etc.) so the HTTP layer can
 *  emit a clean 410 Gone rather than a confusing 500. */
export async function openExportFile(
  companyId: number,
  exportId: number,
): Promise<{
  row: PayrollExport;
  absolutePath: string;
} | null> {
  const row = await db('payroll_exports as p')
    .leftJoin('users as u', 'u.id', 'p.exported_by')
    .where({ 'p.company_id': companyId, 'p.id': exportId })
    .first<PayrollExportRow & { email: string | null }>();
  if (!row) throw NotFound('Export not found');

  const absolutePath = path.resolve(env.EXPORTS_DIR, row.file_path);
  try {
    await fs.access(absolutePath);
  } catch {
    return null;
  }
  return { row: rowToExport(row, row.email), absolutePath };
}
