// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import archiver from 'archiver';
import type { Writable } from 'node:stream';
import { db } from '../db/knex.js';
import { VERSION, GIT_SHA, BUILD_DATE } from '../version.js';

/**
 * Level-4 backup: on-demand "export everything" for a single company as a
 * single ZIP. This is a logical export — JSON-Lines per table — not a
 * Postgres dump. Customers use it to (a) verify the Level-1/2/3 pipeline
 * is not the only path to their data, (b) take their data with them if
 * they leave the platform, (c) hand raw rows to a CPA for an audit.
 *
 * Structure:
 *   manifest.json
 *   company.json
 *   tables/employees.jsonl
 *   tables/jobs.jsonl
 *   tables/time_entries.jsonl
 *   tables/time_entry_audit.jsonl
 *   tables/correction_requests.jsonl
 *   tables/payroll_exports.jsonl
 *   tables/kiosk_devices.jsonl
 *   tables/notifications_log.jsonl
 *   tables/auth_events.jsonl
 *   tables/ai_correction_usage.jsonl
 *   tables/company_memberships.jsonl
 *   tables/company_settings.json  (single row)
 *
 * Sensitive columns (encrypted API keys, PIN hashes, refresh tokens) are
 * redacted — the export is portable across appliances but cannot be used
 * to impersonate an employee or smuggle credentials.
 */

type ExportOpts = {
  companyId: number;
  requestedBy: { id: number; email: string };
};

const REDACT_COLUMNS_BY_TABLE: Record<string, Set<string>> = {
  employees: new Set(['pin_hash', 'pin_fingerprint', 'password_hash']),
  company_memberships: new Set(['password_hash']),
  company_settings: new Set([
    'twilio_auth_token_encrypted',
    'emailit_api_key_encrypted',
    'ai_api_key_encrypted',
  ]),
  companies: new Set(['license_key_encrypted']),
  kiosk_devices: new Set(['token_hash']),
};

function redactRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const drops = REDACT_COLUMNS_BY_TABLE[table];
  if (!drops) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = drops.has(k) ? '[[redacted]]' : v;
  }
  return out;
}

async function streamTable(
  archive: archiver.Archiver,
  table: string,
  where: Record<string, unknown>,
  path: string,
): Promise<number> {
  const rows = await db(table).where(where).select<Record<string, unknown>[]>('*');
  const jsonl = rows.map((r) => JSON.stringify(redactRow(table, r))).join('\n') + '\n';
  archive.append(jsonl, { name: path });
  return rows.length;
}

/**
 * Write a ZIP of the company's data to `out`. Resolves once finalization
 * is complete and the archive has drained.
 */
export async function exportCompanyAll(out: Writable, opts: ExportOpts): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(out);

  const company = await db('companies').where({ id: opts.companyId }).first();
  if (!company) throw new Error(`company ${opts.companyId} not found`);
  archive.append(JSON.stringify(company, null, 2), { name: 'company.json' });

  const settings = await db('company_settings').where({ company_id: opts.companyId }).first();
  if (settings) {
    archive.append(JSON.stringify(redactRow('company_settings', settings), null, 2), {
      name: 'tables/company_settings.json',
    });
  }

  const counts: Record<string, number> = {};
  const tables: Array<[string, Record<string, unknown>, string]> = [
    ['employees', { company_id: opts.companyId }, 'tables/employees.jsonl'],
    ['jobs', { company_id: opts.companyId }, 'tables/jobs.jsonl'],
    ['time_entries', { company_id: opts.companyId }, 'tables/time_entries.jsonl'],
    ['time_entry_audit', { company_id: opts.companyId }, 'tables/time_entry_audit.jsonl'],
    ['correction_requests', { company_id: opts.companyId }, 'tables/correction_requests.jsonl'],
    ['payroll_exports', { company_id: opts.companyId }, 'tables/payroll_exports.jsonl'],
    ['kiosk_devices', { company_id: opts.companyId }, 'tables/kiosk_devices.jsonl'],
    ['notifications_log', { company_id: opts.companyId }, 'tables/notifications_log.jsonl'],
    ['auth_events', { company_id: opts.companyId }, 'tables/auth_events.jsonl'],
    ['ai_correction_usage', { company_id: opts.companyId }, 'tables/ai_correction_usage.jsonl'],
    ['company_memberships', { company_id: opts.companyId }, 'tables/company_memberships.jsonl'],
  ];

  for (const [table, where, path] of tables) {
    try {
      counts[table] = await streamTable(archive, table, where, path);
    } catch (err) {
      counts[table] = -1;
      archive.append(JSON.stringify({ error: (err as Error).message }, null, 2) + '\n', {
        name: path + '.error.json',
      });
    }
  }

  const manifest = {
    kind: 'vibept.company.export',
    version: 1,
    generatedAt: new Date().toISOString(),
    appliance: {
      version: VERSION,
      gitSha: GIT_SHA,
      buildDate: BUILD_DATE,
    },
    company: { id: company.id, name: company.name, slug: company.slug },
    requestedBy: opts.requestedBy,
    rowCounts: counts,
    notes: [
      'JSONL files contain one JSON object per line.',
      'Sensitive columns (API keys, PIN + password hashes, refresh tokens) are redacted.',
      'This export is not a Postgres dump; restoring requires a target company on a Vibe PT appliance.',
    ],
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  await archive.finalize();
}
