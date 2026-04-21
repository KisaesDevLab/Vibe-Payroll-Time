import fs from 'node:fs';
import path from 'node:path';
import type { TunnelApplyState, TunnelStatusResponse } from '@vibept/shared';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';

/**
 * Cloudflare Tunnel SuperAdmin manager.
 *
 * Design mirrors `update-manager.ts`: the backend container writes a
 * request file into `/app/update-control/` (bind-mounted from the
 * host's `/opt/vibept/update-control/`) and a systemd path unit on
 * the host picks it up and invokes `tunnel-from-request.sh`, which
 * mutates `.env` and restarts the cloudflared sidecar under the
 * cloudflare compose profile.
 *
 * The host script writes `tunnel-status.json` back into the same
 * directory so the backend + UI can observe progress without needing
 * direct docker access. This module is the only consumer of those
 * files on the backend side.
 *
 * Token handling: the plaintext token lives exactly twice — in the
 * request file on disk (transient, under 0700 perms, deleted after
 * apply) and in `.env` (chmod 600). It is NEVER stored in the DB.
 * The DB only tracks a `token_set` boolean so the UI can render
 * "configured" without seeing the secret.
 */

function controlPaths() {
  const dir = process.env.UPDATE_CONTROL_DIR ?? '/app/update-control';
  return {
    dir,
    request: path.join(dir, 'tunnel-request.json'),
    status: path.join(dir, 'tunnel-status.json'),
  };
}

interface TunnelDbRow {
  cloudflare_tunnel_enabled: boolean;
  cloudflare_tunnel_token_set: boolean;
  cloudflare_tunnel_last_applied_at: Date | null;
  cloudflare_tunnel_last_error: string | null;
}

async function loadRow(): Promise<TunnelDbRow> {
  const row = await db('appliance_settings').where({ id: 1 }).first<TunnelDbRow>();
  if (!row) throw new Error('appliance_settings singleton missing');
  return row;
}

function readApplyState(): TunnelApplyState {
  const { request, status } = controlPaths();
  // A request file still on disk = the host hasn't processed it yet.
  if (fs.existsSync(request)) return 'queued';
  if (!fs.existsSync(status)) return 'idle';
  try {
    const raw = JSON.parse(fs.readFileSync(status, 'utf8')) as { state?: string };
    const s = raw.state;
    if (s === 'running' || s === 'ok' || s === 'failed') return s;
    return 'idle';
  } catch (err) {
    logger.warn({ err }, 'tunnel-status.json malformed');
    return 'idle';
  }
}

function ensureControlDir(): void {
  const { dir } = controlPaths();
  if (!fs.existsSync(dir)) {
    throw Object.assign(
      new Error(
        'update-control volume not mounted — tunnel manager requires the systemd units to be installed',
      ),
      {
        code: 'updater_not_wired',
      },
    );
  }
}

function updaterWired(): boolean {
  try {
    return fs.existsSync(controlPaths().dir);
  } catch {
    return false;
  }
}

export async function getTunnelStatus(): Promise<TunnelStatusResponse> {
  const row = await loadRow();
  return {
    enabled: row.cloudflare_tunnel_enabled,
    hasToken: row.cloudflare_tunnel_token_set,
    lastAppliedAt: row.cloudflare_tunnel_last_applied_at?.toISOString() ?? null,
    lastError: row.cloudflare_tunnel_last_error,
    applyState: readApplyState(),
    updaterWired: updaterWired(),
  };
}

export interface RequestTunnelChangeInput {
  enabled?: boolean | undefined;
  /** `string` = set/rotate · `null` = clear · `undefined` = leave alone. */
  token?: string | null | undefined;
  actor: { userId: number; email: string };
}

export async function requestTunnelChange(
  input: RequestTunnelChangeInput,
): Promise<TunnelStatusResponse> {
  ensureControlDir();

  const row = await loadRow();

  // Derive the effective target state. Clearing the token implies
  // disabling — cloudflared with no token fails on boot and we'd just
  // thrash restart attempts.
  const targetEnabled =
    input.token === null ? false : (input.enabled ?? row.cloudflare_tunnel_enabled);
  const targetHasToken =
    input.token === null
      ? false
      : input.token !== undefined
        ? true
        : row.cloudflare_tunnel_token_set;

  // Build the host-side action payload. Only include the token when
  // actually being set/cleared — leaving it `undefined` tells the host
  // script "keep whatever's in .env".
  const payload: Record<string, unknown> = {
    requested_by_user_id: input.actor.userId,
    requested_by_email: input.actor.email,
    requested_at: new Date().toISOString(),
    target_enabled: targetEnabled,
    token_action: input.token === undefined ? 'keep' : input.token === null ? 'clear' : 'set',
  };
  if (typeof input.token === 'string') {
    payload.token = input.token;
  }

  // Write atomically. The request-file permissions matter because the
  // token is plaintext until the host script applies it; the containing
  // directory is chmod 700 (the installer does this), which is the
  // primary containment.
  const { request } = controlPaths();
  const tmp = `${request}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.promises.rename(tmp, request);

  // Optimistically update DB state so the UI reflects the intent even
  // before the host script confirms. The host script writes back the
  // real `last_applied_at` + error state after apply; we update those
  // via refreshFromStatusFile().
  await db('appliance_settings').where({ id: 1 }).update({
    cloudflare_tunnel_enabled: targetEnabled,
    cloudflare_tunnel_token_set: targetHasToken,
    updated_at: db.fn.now(),
  });

  logger.info(
    { userId: input.actor.userId, targetEnabled, tokenAction: payload.token_action },
    'tunnel change requested',
  );

  return getTunnelStatus();
}

/**
 * Pick up the host script's `tunnel-status.json` and reconcile DB
 * state. Idempotent — safe to call on every GET. We only write to the
 * DB when the status file's `apply_id` is newer than the one we last
 * reconciled (tracked via `last_applied_at`).
 */
export async function reconcileFromStatusFile(): Promise<void> {
  const { status } = controlPaths();
  if (!fs.existsSync(status)) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(status, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const state = String(data.state ?? '');
  if (state !== 'ok' && state !== 'failed') return;

  const appliedAtStr = typeof data.applied_at === 'string' ? data.applied_at : null;
  const error = typeof data.error === 'string' && data.error.length > 0 ? data.error : null;
  const appliedAt = appliedAtStr ? new Date(appliedAtStr) : null;

  const current = await loadRow();
  const currentStamp = current.cloudflare_tunnel_last_applied_at?.toISOString() ?? null;
  if (appliedAtStr && currentStamp === appliedAtStr) return; // already reconciled

  await db('appliance_settings')
    .where({ id: 1 })
    .update({
      cloudflare_tunnel_last_applied_at:
        state === 'ok' ? appliedAt : current.cloudflare_tunnel_last_applied_at,
      cloudflare_tunnel_last_error: state === 'failed' ? error : null,
      updated_at: db.fn.now(),
    });
}
