// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';

// Phase 14.2: TENANT_MODE governs whether the appliance hosts many
// companies (`multi`, the standalone default and pre-Phase-14
// behavior) or exactly one (`single`, the appliance-overlay default).
//
// `single` mode rejects more than one active company at boot — the
// operator either exported and re-imported one firm, or they
// configured the appliance against the wrong DB. Either way we want
// the boot to fail loudly, not silently flip a multi-firm DB into a
// single-tenant view that hides the others.

export type TenantMode = 'single' | 'multi';

export type TenantBootDecision =
  | { kind: 'ok'; mode: TenantMode; companyCount: number }
  | { kind: 'refuse'; reason: string };

export async function inspectTenantBoot(): Promise<TenantBootDecision> {
  const mode = env.TENANT_MODE;

  // Count active (non-disabled) companies. Soft-deleted companies don't
  // count — `disabled_at IS NULL` is the active scope used by
  // companies queries elsewhere in the codebase.
  let companyCount: number;
  try {
    const row = await db('companies')
      .whereNull('disabled_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    companyCount = Number(row?.count ?? 0);
  } catch (err) {
    // Most common cause: `MIGRATIONS_AUTO=false` on the appliance
    // overlay and the parent appliance hasn't run the one-shot
    // migrate sidecar yet, so the `companies` table doesn't exist.
    // Surface the operational gap instead of letting "relation
    // companies does not exist" propagate as a generic boot failure.
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: 'refuse',
      reason:
        `tenant-mode boot guard could not count companies: ${message}. ` +
        'Most likely the database schema is not migrated yet. With ' +
        'MIGRATIONS_AUTO=false (the appliance default) the parent ' +
        'appliance must run a migrate sidecar before bringing this ' +
        'container up. With MIGRATIONS_AUTO=true (the standalone ' +
        'default) migrations should have run earlier in this same ' +
        'process — check the boot logs above for migration errors.',
    };
  }

  if (mode === 'single' && companyCount > 1) {
    return {
      kind: 'refuse',
      reason:
        `TENANT_MODE=single but the database holds ${companyCount} active companies. ` +
        'A multi-firm DB cannot run in single-tenant mode without losing visibility ' +
        'of all but one firm. Either export the desired firm and restore it into a ' +
        'fresh appliance, or set TENANT_MODE=multi.',
    };
  }

  return { kind: 'ok', mode, companyCount };
}

export async function enforceTenantMode(): Promise<void> {
  const decision = await inspectTenantBoot();
  if (decision.kind === 'refuse') {
    logger.fatal({ reason: decision.reason }, 'tenant-mode boot guard refused');
    throw new Error(decision.reason);
  }
  logger.info(
    { mode: decision.mode, companyCount: decision.companyCount },
    'tenant-mode boot guard ok',
  );
}

/**
 * Public summary of tenant-mode state for the frontend's pre-auth
 * /appliance/info endpoint. The frontend hides multi-firm affordances
 * when `mode === 'single'`, and pre-fills the setup wizard's company
 * name with `firmName` when present.
 */
export function getTenantModeInfo(): {
  mode: TenantMode;
  firmName: string | null;
} {
  return {
    mode: env.TENANT_MODE,
    firmName: env.FIRM_NAME ?? null,
  };
}
