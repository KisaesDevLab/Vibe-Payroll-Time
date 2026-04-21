import { z } from 'zod';

/** What's currently running on the appliance. Sourced from build args
 *  baked into the image by install.sh / update.sh (git describe + SHA). */
export const runningVersionSchema = z.object({
  version: z.string(),
  gitSha: z.string(),
  buildDate: z.string(),
});

export type RunningVersion = z.infer<typeof runningVersionSchema>;

/** Subset of the GitHub Releases API response we care about. */
export const latestReleaseSchema = z.object({
  tagName: z.string(),
  name: z.string(),
  publishedAt: z.string(),
  body: z.string(),
  url: z.string(),
});

export type LatestRelease = z.infer<typeof latestReleaseSchema>;

/** Persisted between runs of update-from-request.sh so the UI can show
 *  the outcome of the most recent update even after the backend restarts. */
export const lastRunSchema = z.object({
  state: z.enum(['running', 'finished']),
  outcome: z.enum(['', 'success', 'failed']).default(''),
  message: z.string().default(''),
  pre_sha: z.string().default(''),
  post_sha: z.string().default(''),
  updated_at: z.string().default(''),
});

export type LastRun = z.infer<typeof lastRunSchema>;

/** Cheap-and-fast status — no external network call. Polled while an
 *  update is running so the UI can show progress. */
export const updateStatusResponseSchema = z.object({
  running: runningVersionSchema,
  inProgress: z.boolean(),
  lastRun: lastRunSchema.nullable(),
});

export type UpdateStatusResponse = z.infer<typeof updateStatusResponseSchema>;

/** On-demand GitHub check. The SuperAdmin clicks a button to trigger it;
 *  we do not poll on a timer (respects GitHub's 60/hr unauth rate limit
 *  and makes the UX feel intentional). */
export const updateCheckResponseSchema = z.object({
  latest: latestReleaseSchema.nullable(),
  reachable: z.boolean(),
  error: z.string().nullable(),
});

export type UpdateCheckResponse = z.infer<typeof updateCheckResponseSchema>;

/** Response to POST /admin/update/run — the update is queued on disk;
 *  systemd picks up the request file and fires update-from-request.sh. */
export const updateRunResponseSchema = z.object({
  queued: z.boolean(),
  requestedAt: z.string(),
});

export type UpdateRunResponse = z.infer<typeof updateRunResponseSchema>;

/** Byte-offset-based log tail. The client sends `since=<last-offset>` and
 *  gets back the next chunk plus a new offset. Simpler than SSE and
 *  survives the mid-update restart of the backend container. */
export const updateLogResponseSchema = z.object({
  content: z.string(),
  nextOffset: z.number().int().nonnegative(),
  complete: z.boolean(),
});

export type UpdateLogResponse = z.infer<typeof updateLogResponseSchema>;
