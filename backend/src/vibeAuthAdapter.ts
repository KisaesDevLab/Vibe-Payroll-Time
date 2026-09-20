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
 *     breakglass ensure|rotate|status --json
 *
 * The CLI finds this file through VIBE_AUTH_ADAPTER (set in the image,
 * because its cwd /app is the workspace root, not backend/) or through
 * backend/package.json → "vibeAuth". It runs in its own process with the
 * container's env; nothing here touches Express.
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
