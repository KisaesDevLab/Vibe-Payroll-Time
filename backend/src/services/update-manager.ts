import fs from 'node:fs';
import path from 'node:path';
import {
  lastRunSchema,
  type LastRun,
  type LatestRelease,
  type RunningVersion,
  type UpdateCheckResponse,
  type UpdateLogResponse,
  type UpdateRunResponse,
} from '@vibept/shared';
import { BUILD_DATE, GIT_SHA, VERSION } from '../version.js';
import { logger } from '../config/logger.js';

/**
 * Self-service appliance updater bridge.
 *
 * How it works at runtime:
 *
 *   1. The backend container has /app/update-control bind-mounted from
 *      the host's /opt/vibept/update-control (see docker-compose.prod.yml).
 *   2. When the SuperAdmin clicks "Update Now", we write request.json to
 *      that shared directory and return 202.
 *   3. A host-side systemd path unit (vibept-updater.path) notices the
 *      file appearing and fires vibept-updater.service, which runs
 *      update-from-request.sh. That wrapper calls update.sh with output
 *      tee'd to log.txt, then writes status.json and removes request.json.
 *   4. The UI polls /admin/update/log?since=<offset> to tail log.txt
 *      and /admin/update/status to see when the run finishes.
 *
 * The backend never execs update.sh directly — if it did, killing its
 * own container mid-update would truncate the script. The systemd
 * indirection is what makes this safe.
 */

const GITHUB_REPO = 'KisaesDevLab/Vibe-Payroll-Time';
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const LOG_CHUNK_BYTES = 64 * 1024;

// Resolved lazily so tests (and ops overrides) can change
// UPDATE_CONTROL_DIR via env without re-importing the module. In
// production the backend container sets this once via compose and never
// changes it.
function controlPaths() {
  const dir = process.env.UPDATE_CONTROL_DIR ?? '/app/update-control';
  return {
    dir,
    request: path.join(dir, 'request.json'),
    status: path.join(dir, 'status.json'),
    log: path.join(dir, 'log.txt'),
  };
}

export function getRunningVersion(): RunningVersion {
  return { version: VERSION, gitSha: GIT_SHA, buildDate: BUILD_DATE };
}

export function readLastRun(): LastRun | null {
  const { status } = controlPaths();
  try {
    if (!fs.existsSync(status)) return null;
    const raw = fs.readFileSync(status, 'utf8');
    const parsed = lastRunSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn({ err: parsed.error }, 'update-control/status.json malformed');
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err }, 'failed to read update-control/status.json');
    return null;
  }
}

export function isUpdateInProgress(): boolean {
  const { request } = controlPaths();
  if (fs.existsSync(request)) return true;
  const last = readLastRun();
  return last?.state === 'running';
}

/**
 * Hit GitHub's public releases API for the latest tagged release. No
 * caching — the SuperAdmin clicks "Check" explicitly, so a round-trip
 * per click is fine and GitHub's 60/hr unauth rate limit is ample for
 * a single operator. Returns a nullable result so the UI can degrade
 * gracefully on air-gapped appliances or GitHub outages.
 */
export async function checkLatestRelease(): Promise<UpdateCheckResponse> {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        'User-Agent': 'vibept-appliance',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return { latest: null, reachable: true, error: 'no releases published yet' };
    }
    if (!res.ok) {
      return { latest: null, reachable: true, error: `github responded ${res.status}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const latest: LatestRelease = {
      tagName: String(data.tag_name ?? ''),
      name: String(data.name ?? ''),
      publishedAt: String(data.published_at ?? ''),
      body: String(data.body ?? ''),
      url: String(data.html_url ?? ''),
    };
    return { latest, reachable: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return { latest: null, reachable: false, error: message };
  }
}

function ensureControlDir(): void {
  const { dir } = controlPaths();
  if (!fs.existsSync(dir)) {
    // We intentionally don't auto-create — if the volume isn't mounted,
    // the updater systemd unit isn't wired up, and silently creating the
    // directory inside the container hides the misconfiguration.
    throw Object.assign(new Error('update-control volume not mounted'), {
      code: 'updater_not_wired',
    });
  }
}

export async function requestUpdate(opts: {
  userId: number;
  userEmail: string;
}): Promise<UpdateRunResponse> {
  ensureControlDir();

  if (isUpdateInProgress()) {
    throw Object.assign(new Error('update already in progress'), { code: 'conflict' });
  }

  const requestedAt = new Date().toISOString();
  const payload = {
    requested_by_user_id: opts.userId,
    requested_by_email: opts.userEmail,
    requested_at: requestedAt,
  };

  // Write + rename atomic-ish so the systemd path unit never sees a
  // half-written request file.
  const { request } = controlPaths();
  const tmp = `${request}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.promises.rename(tmp, request);

  logger.info({ userId: opts.userId, requestedAt }, 'update requested');
  return { queued: true, requestedAt };
}

/**
 * Byte-offset log tail. Client sends `since=N`, we read from N up to
 * current EOF (or 64 KiB max per call, whichever is smaller), return the
 * new bytes + the new offset. `complete` flips to true when there's no
 * update in progress AND we've caught up to EOF.
 */
export function readLogChunk(sinceOffset: number): UpdateLogResponse {
  const offset = Math.max(0, Math.floor(sinceOffset));
  const { log } = controlPaths();

  if (!fs.existsSync(log)) {
    return { content: '', nextOffset: offset, complete: !isUpdateInProgress() };
  }

  const stat = fs.statSync(log);

  // If the log was rotated / truncated under us (size < offset), reset.
  if (stat.size < offset) {
    return { content: '', nextOffset: 0, complete: !isUpdateInProgress() };
  }

  if (offset >= stat.size) {
    return { content: '', nextOffset: stat.size, complete: !isUpdateInProgress() };
  }

  const length = Math.min(stat.size - offset, LOG_CHUNK_BYTES);
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(log, 'r');
  try {
    fs.readSync(fd, buf, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const newOffset = offset + length;
  return {
    content: buf.toString('utf8'),
    nextOffset: newOffset,
    complete: !isUpdateInProgress() && newOffset >= stat.size,
  };
}
