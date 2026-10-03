// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { VibeAuthCliAdapter } from '@kisaesdevlab/vibe-auth';
import { BREAKGLASS_EMAIL } from '@vibept/shared';
import { closeDb } from './db/knex.js';
import { VIBE_PT_ADMIN_ROLE, createVibeUsers, vibeAuditSink } from './services/vibe-auth/users.js';

/**
 * Adapter module for the `vibe-auth` CLI (break-glass account management).
 * The image has no build step, so the CLI runs under tsx, from /app:
 *
 *   node --import tsx/esm node_modules/@kisaesdevlab/vibe-auth/dist/cli.js \
 *     breakglass ensure|rotate|status|verify --json
 *
 * The CLI finds this file through `"vibeAuth": { "adapter" }` in the
 * package.json of its cwd: the root one under /app in the image,
 * backend/package.json when run from backend/ in dev. VIBE_AUTH_ADAPTER
 * overrides both but is set nowhere. It runs in its own process with the
 * container's env; nothing here touches Express.
 *
 * No `breakglassCheck`: staff accounts have no second factor, lockout or
 * forced password change here, so `status` has nothing to add to
 * exists / active / admin.
 *
 * `breakglassEmail` must stay the address the login route maps the bare
 * `vibe-breakglass` username to — both read BREAKGLASS_EMAIL so they
 * cannot drift.
 */
const adapter: VibeAuthCliAdapter = {
  users: createVibeUsers(),
  audit: vibeAuditSink,
  adminRole: VIBE_PT_ADMIN_ROLE,
  breakglassEmail: BREAKGLASS_EMAIL,
  close: () => closeDb(),
};

export default adapter;
