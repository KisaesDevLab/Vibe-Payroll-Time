import type {
  Company,
  CompanyRole,
  CreateCompanyRequest,
  UpdateCompanyRequest,
} from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { Conflict, NotFound } from '../http/errors.js';

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  week_start_day: number;
  pay_period_type: Company['payPeriodType'];
  pay_period_anchor: string | null;
  is_internal: boolean;
  license_state: Company['licenseState'];
  license_expires_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToCompany(row: CompanyRow, employeeCount?: number): Company {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    weekStartDay: row.week_start_day,
    payPeriodType: row.pay_period_type,
    payPeriodAnchor: row.pay_period_anchor,
    isInternal: row.is_internal,
    licenseState: row.license_state,
    licenseExpiresAt: row.license_expires_at?.toISOString() ?? null,
    disabledAt: row.disabled_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    ...(employeeCount !== undefined ? { employeeCount } : {}),
  };
}

/** Defaults applied when a company_settings row is created. */
export function defaultSettingsForCompany(isInternal: boolean): Record<string, unknown> {
  return {
    allow_self_approve: isInternal,
    // Other columns have DB-level defaults that take over.
  };
}

/**
 * Create a company + its settings row in a single transaction. Exposed so
 * the setup service and the SuperAdmin companies endpoint both go through
 * the same chokepoint.
 */
export async function createCompany(
  body: CreateCompanyRequest,
  trx?: Knex.Transaction,
): Promise<Company> {
  const exec = async (t: Knex.Transaction) => {
    const existing = await t('companies').where({ slug: body.slug }).first<{ id: number }>();
    if (existing) throw Conflict(`Slug "${body.slug}" is already in use`);

    const [row] = await t('companies')
      .insert({
        name: body.name,
        slug: body.slug,
        timezone: body.timezone,
        week_start_day: body.weekStartDay,
        pay_period_type: body.payPeriodType,
        pay_period_anchor: body.payPeriodAnchor ?? null,
        is_internal: body.isInternal,
        license_state: body.isInternal ? 'internal_free' : 'trial',
        license_expires_at: body.isInternal
          ? null
          : t.raw("now() + interval '14 days'"),
      })
      .returning<CompanyRow[]>('*');

    if (!row) throw new Error('failed to create company');

    await t('company_settings').insert({
      company_id: row.id,
      ...defaultSettingsForCompany(row.is_internal),
    });

    return rowToCompany(row);
  };

  return trx ? exec(trx) : db.transaction(exec);
}

/** Scope filter used by callers that list companies based on who is asking. */
export interface ListCompaniesScope {
  roleGlobal: 'super_admin' | 'none';
  userId: number;
  /** Optional filter — limit to a single company id. */
  onlyId?: number;
}

export async function listCompanies(scope: ListCompaniesScope): Promise<Company[]> {
  // LEFT JOIN against active employees so companies with zero active staff
  // still show up in the list with count=0. Filtering `e.status` with a top-
  // level .where() would turn this into an effective INNER JOIN.
  const q = db('companies as c')
    .leftJoin('employees as e', function () {
      this.on('e.company_id', '=', 'c.id').andOnVal('e.status', '=', 'active');
    })
    .groupBy('c.id');

  if (scope.roleGlobal !== 'super_admin') {
    q.innerJoin('company_memberships as m', 'm.company_id', 'c.id').where(
      'm.user_id',
      scope.userId,
    );
  }
  if (scope.onlyId) q.where('c.id', scope.onlyId);

  const rows = await q.select<Array<CompanyRow & { employee_count: string }>>(
    'c.*',
    db.raw('count(e.id) as employee_count'),
  );

  return rows.map((r) => rowToCompany(r, Number(r.employee_count)));
}

export async function findCompanyById(
  companyId: number,
  trx?: Knex.Transaction,
): Promise<Company | undefined> {
  const q = trx ?? db;
  const row = await q<CompanyRow>('companies').where({ id: companyId }).first();
  return row ? rowToCompany(row) : undefined;
}

export async function requireCompany(
  companyId: number,
  trx?: Knex.Transaction,
): Promise<Company> {
  const found = await findCompanyById(companyId, trx);
  if (!found) throw NotFound('Company not found');
  return found;
}

export async function updateCompany(
  companyId: number,
  patch: UpdateCompanyRequest,
): Promise<Company> {
  return db.transaction(async (trx) => {
    if (patch.slug) {
      const clash = await trx('companies')
        .where({ slug: patch.slug })
        .whereNot({ id: companyId })
        .first<{ id: number }>();
      if (clash) throw Conflict(`Slug "${patch.slug}" is already in use`);
    }

    const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.slug !== undefined) updates.slug = patch.slug;
    if (patch.timezone !== undefined) updates.timezone = patch.timezone;
    if (patch.weekStartDay !== undefined) updates.week_start_day = patch.weekStartDay;
    if (patch.payPeriodType !== undefined) updates.pay_period_type = patch.payPeriodType;
    if (patch.payPeriodAnchor !== undefined) updates.pay_period_anchor = patch.payPeriodAnchor;
    if (patch.isInternal !== undefined) updates.is_internal = patch.isInternal;

    await trx('companies').where({ id: companyId }).update(updates);
    return requireCompany(companyId, trx);
  });
}

export async function userCanAccessCompany(
  userId: number,
  companyId: number,
  roleGlobal: 'super_admin' | 'none',
  minRole?: CompanyRole,
): Promise<boolean> {
  if (roleGlobal === 'super_admin') return true;
  const m = await db('company_memberships')
    .where({ user_id: userId, company_id: companyId })
    .first<{ role: CompanyRole }>();
  if (!m) return false;
  if (!minRole) return true;

  const rank: Record<CompanyRole, number> = {
    employee: 1,
    supervisor: 2,
    company_admin: 3,
  };
  return rank[m.role] >= rank[minRole];
}
