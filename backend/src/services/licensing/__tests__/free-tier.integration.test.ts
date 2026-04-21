// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Free-tier licensing rule: the first FREE_CLIENT_COMPANY_CAP
 * non-internal companies on the appliance resolve to `internal_free`,
 * ranked by created_at asc. Company #6 and beyond follows the
 * appliance license state.
 *
 * Exercises the real DB so the SQL in isFreeTierClient is validated.
 */
import { FREE_CLIENT_COMPANY_CAP } from '@vibept/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../db/knex.js';
import { runMigrations } from '../../../db/migrate.js';
import { getLicenseStatusForCompany, isFreeTierClient } from '../state.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

async function wipe() {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies
     RESTART IDENTITY CASCADE`,
  );
}

async function createCompany(opts: {
  slug: string;
  name?: string;
  isInternal?: boolean;
  createdAt?: Date;
  disabledAt?: Date | null;
}): Promise<{ id: number; is_internal: boolean; created_at: Date }> {
  const [row] = await db('companies')
    .insert({
      name: opts.name ?? opts.slug,
      slug: opts.slug,
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: opts.isInternal ?? false,
      license_state: opts.isInternal ? 'internal_free' : 'trial',
      created_at: opts.createdAt ?? db.fn.now(),
      disabled_at: opts.disabledAt ?? null,
    })
    .returning<Array<{ id: number; is_internal: boolean; created_at: Date }>>([
      'id',
      'is_internal',
      'created_at',
    ]);
  return row!;
}

beforeAll(async () => {
  if (!dbReachable) return;
  await runMigrations();
});

beforeEach(async () => {
  if (!dbReachable) return;
  await wipe();
});

afterAll(async () => {
  if (dbReachable) await db.destroy();
});

describe.skipIf(!dbReachable)('free-tier licensing', () => {
  it('internal companies are always free regardless of rank', async () => {
    const internal = await createCompany({ slug: 'internal-firm', isInternal: true });
    expect(await isFreeTierClient(internal.id, internal)).toBe(false);
    const status = await getLicenseStatusForCompany(internal.id);
    expect(status.state).toBe('internal_free');
  });

  it('first 5 non-internal companies are in the free tier', async () => {
    const created: Array<{ id: number; is_internal: boolean; created_at: Date }> = [];
    const base = Date.now() - 10 * 86_400_000;
    for (let i = 0; i < FREE_CLIENT_COMPANY_CAP; i++) {
      created.push(
        await createCompany({
          slug: `client-${i}`,
          createdAt: new Date(base + i * 86_400_000),
        }),
      );
    }
    for (const c of created) {
      expect(await isFreeTierClient(c.id, c)).toBe(true);
      const status = await getLicenseStatusForCompany(c.id);
      expect(status.state).toBe('internal_free');
    }
  });

  it('6th client is NOT in the free tier', async () => {
    const base = Date.now() - 10 * 86_400_000;
    for (let i = 0; i < FREE_CLIENT_COMPANY_CAP; i++) {
      await createCompany({
        slug: `client-${i}`,
        createdAt: new Date(base + i * 86_400_000),
      });
    }
    const sixth = await createCompany({
      slug: 'client-6',
      createdAt: new Date(base + FREE_CLIENT_COMPANY_CAP * 86_400_000),
    });
    expect(await isFreeTierClient(sixth.id, sixth)).toBe(false);
    const status = await getLicenseStatusForCompany(sixth.id);
    expect(status.state).not.toBe('internal_free');
  });

  it('disabled companies free up their slot — the next created fills it', async () => {
    const base = Date.now() - 10 * 86_400_000;
    const clients = [];
    for (let i = 0; i < FREE_CLIENT_COMPANY_CAP; i++) {
      clients.push(
        await createCompany({
          slug: `client-${i}`,
          createdAt: new Date(base + i * 86_400_000),
        }),
      );
    }
    await db('companies').where({ id: clients[0]!.id }).update({ disabled_at: db.fn.now() });
    const replacement = await createCompany({ slug: 'replacement', createdAt: new Date() });
    expect(await isFreeTierClient(replacement.id, replacement)).toBe(true);
  });

  it('internal companies do NOT consume a free-tier slot', async () => {
    const base = Date.now() - 10 * 86_400_000;
    await createCompany({ slug: 'firm', isInternal: true, createdAt: new Date(base) });
    const nonInternal = [];
    for (let i = 0; i < FREE_CLIENT_COMPANY_CAP; i++) {
      nonInternal.push(
        await createCompany({
          slug: `client-${i}`,
          createdAt: new Date(base + (i + 1) * 86_400_000),
        }),
      );
    }
    for (const c of nonInternal) {
      expect(await isFreeTierClient(c.id, c)).toBe(true);
    }
  });
});
