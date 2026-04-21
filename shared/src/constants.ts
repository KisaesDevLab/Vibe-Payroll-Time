// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/** API path prefix for all backend endpoints. */
export const API_PREFIX = '/api/v1';

/** JWT access token lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** JWT refresh token lifetime (standard). */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Extended refresh token lifetime for "remember this device" on personal devices only. */
export const REFRESH_TOKEN_REMEMBER_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Kiosk device pairing code validity window. */
export const KIOSK_PAIRING_CODE_TTL_SECONDS = 15 * 60;

/** Kiosk lockout threshold after bad PIN attempts. */
export const KIOSK_BAD_PIN_LIMIT = 3;
export const KIOSK_BAD_PIN_LOCKOUT_SECONDS = 30;

/** Auto-lock kiosk PIN screen after this inactivity window. */
export const KIOSK_IDLE_LOCK_SECONDS = 30;

/** Reject offline punches older than this when flushed. */
export const OFFLINE_PUNCH_MAX_AGE_SECONDS = 72 * 60 * 60;

/** Company license grace period. */
export const LICENSE_GRACE_DAYS = 60;

/** Trial duration for first client-portal company. */
export const LICENSE_TRIAL_DAYS = 14;

/**
 * Appliance-wide free tier. Up to this many client (non-internal)
 * companies run for free — ranked by created_at ascending so a firm
 * can't cycle through deletes to stay under the cap. Companies beyond
 * this cap fall through to the appliance-wide license state
 * (trial/licensed/grace/expired).
 *
 * Remote access (personal-device PWA from anywhere) is feature-complete
 * regardless of tier — it ships enabled for every company.
 */
export const FREE_CLIENT_COMPANY_CAP = 5;

/** FLSA weekly overtime threshold in hours. */
export const FLSA_OT_THRESHOLD_HOURS = 40;

/** PIN length bounds. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** Rate limit budgets. */
export const AUTH_RATE_LIMIT_PER_MINUTE = 10;
export const NL_CORRECTION_LIMIT_PER_EMPLOYEE_PER_DAY = 20;

/** Kiosk badge scan rate limit: trips at 21st scan in a rolling 60s window,
 *  followed by a 60s cooldown. Keeps a bored employee (or an attacker with
 *  a stolen badge photo) from hammering the endpoint. */
export const KIOSK_BADGE_SCAN_LIMIT = 20;
export const KIOSK_BADGE_SCAN_WINDOW_SECONDS = 60;
export const KIOSK_BADGE_SCAN_LOCKOUT_SECONDS = 60;

/** Badge token format version marker. Bumping this invalidates every
 *  badge in the appliance — recovery is bulk-reissue. */
export const BADGE_TOKEN_VERSION = 'vpt1';
