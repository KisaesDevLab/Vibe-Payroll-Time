// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import crypto from 'node:crypto';
import type {
  AuthResponse,
  LinkPurpose,
  MagicLinkOptionsResponse,
  SendAccountLinkResponse,
} from '@vibept/shared';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';
import { BadRequest, NotFound, Unauthorized } from '../http/errors.js';
import {
  getResolvedDisplayName,
  getResolvedEmailit,
  getResolvedSmsProvider,
} from './appliance-settings.js';
import { recordAuthEvent } from './auth-events.js';
import { buildAuthUser } from './auth.js';
import { notify } from './notifications/service.js';
import type { NotificationType } from './notifications/templates.js';
import { issueAccessToken, issueRefreshToken } from './tokens.js';
import { findUserById, healEmployeeLinksForUser, type UserRow } from './users.js';

/**
 * Single-use link tokens. One table backs three flows:
 *
 *   1. Passwordless login          — self-service, from the login page.
 *   2. Password reset              — self-service "I forgot my password".
 *   3. Admin-initiated send/resend — a CompanyAdmin or SuperAdmin
 *                                    pressing "send login link" for
 *                                    somebody they just onboarded.
 *
 * Reset is deliberately NOT a separate token system. A reset link is a
 * magic link whose landing page forces a password change before it
 * hands over the app: consuming it mints a session tagged
 * `authMethod: 'magic_link'`, which is exactly the proof
 * `/auth/set-password` already requires. One token lifecycle, one set
 * of expiry/replay guarantees, one audit trail.
 *
 * Security posture:
 *   - The self-service entry points never reveal whether an identifier
 *     exists — they return 204 on both hit and miss, and swallow every
 *     internal error. Rate-limited to 3 requests per identifier per hour.
 *   - The admin entry point DOES report outcomes. The caller is already
 *     authenticated and already knows the account exists (they are
 *     looking at its row), so there is nothing to enumerate — and a
 *     silent "skipped: no phone on file" would leave them waiting on a
 *     text that never arrives.
 *   - Only the token HASH lives in the DB. A DB dump alone can't log
 *     anyone in.
 *   - Tokens are 32 random bytes (256-bit) base64url, single-use.
 *   - Every request + consume writes an auth_events row for audit.
 *
 * v1 constraint: only works for existing `users` rows. Employees
 * without a user account can't receive a link — they punch at a kiosk
 * with a PIN or badge instead.
 */

const TOKEN_BYTES = 32;
const RATE_LIMIT_PER_HOUR = 3;

/**
 * Reset gets double the login TTL. The flows have different physics: a
 * login link is clicked immediately by someone already at their device,
 * while a reset is often read on a phone, then completed on a laptop
 * where the person has to think up and type a 12-character passphrase.
 * 30 minutes matches what the `password_reset` template promises.
 */
const TTL_MINUTES: Record<LinkPurpose, number> = {
  login: 15,
  password_reset: 30,
};

/** Frontend route the emailed URL points at. */
const LANDING_PATH: Record<LinkPurpose, string> = {
  login: '/auth/magic',
  password_reset: '/auth/reset',
};

const TEMPLATE: Record<LinkPurpose, NotificationType> = {
  login: 'magic_link',
  password_reset: 'password_reset',
};

/** The template var each purpose interpolates its URL into. */
const URL_VAR: Record<LinkPurpose, string> = {
  login: 'magicUrl',
  password_reset: 'resetUrl',
};

export type MagicLinkChannel = 'email' | 'sms';

export interface RequestMagicLinkInput {
  identifier: string;
  channel: MagicLinkChannel;
  /** Origin the login page came from, used to build the callback URL. */
  origin: string;
  ip: string | null;
  userAgent: string | null;
}

export async function getMagicLinkOptions(): Promise<MagicLinkOptionsResponse> {
  // NB: NOTIFICATIONS_DISABLED is intentionally NOT consulted here — it
  // stubs the actual send path (notify() writes a 'disabled' status
  // row), but the options endpoint reports whether email/SMS is
  // *configured* so the login page can render the right buttons. If
  // the operator wants to hide login options, they should unset the
  // appliance-wide provider creds, not flip NOTIFICATIONS_DISABLED.
  const emailit = await getResolvedEmailit();
  const emailEnabled = !!emailit.apiKey && !!emailit.fromEmail;

  // SMS: appliance-wide provider with complete creds for the selected
  // provider, OR any company with complete creds of its own. The
  // notification dispatcher picks the best config at send time.
  const appliance = await getResolvedSmsProvider();
  const applianceHasSms =
    (appliance.provider === 'twilio' && !!appliance.twilio) ||
    (appliance.provider === 'textlinksms' && !!appliance.textlinksms);
  let smsEnabled = applianceHasSms;
  if (!smsEnabled) {
    const twilio = await db('company_settings')
      .whereNotNull('twilio_account_sid')
      .whereNotNull('twilio_auth_token_encrypted')
      .whereNotNull('twilio_from_number')
      .first();
    const textlink = await db('company_settings')
      .whereNotNull('textlinksms_api_key_encrypted')
      .whereNotNull('textlinksms_from_number')
      .first();
    smsEnabled = !!twilio || !!textlink;
  }

  return { emailEnabled, smsEnabled };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mask a delivery address down to a recognition hint. The admin who
 * triggered the send already knows which row they clicked; they don't
 * need the full number echoed back, and the response travels through
 * logs and error toasts.
 */
function maskAddress(address: string, channel: MagicLinkChannel): string {
  if (channel === 'email') {
    const [local = '', domain = ''] = address.split('@');
    const head = local.slice(0, 1);
    return `${head}${'•'.repeat(Math.max(1, local.length - 1))}@${domain}`;
  }
  const tail = address.slice(-2);
  return `•••-••${tail}`;
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * A user plus the address a link should actually be delivered to on the
 * chosen channel.
 *
 * The phone is resolved separately from `users.phone` on purpose. A
 * phone number can live in either of two places: the appliance-wide
 * `users.phone` (set at /preferences, mostly SuperAdmins) or the
 * per-company `employees.phone` (set by an admin, verified by the
 * employee). An hourly employee almost always has only the latter, so
 * passing `users.phone` straight through to notify() would resolve to
 * NULL and skip the send with "no phone on file" — even though the
 * lookup that found the user matched on a perfectly good employee
 * number.
 */
interface Recipient {
  user: UserRow;
  /** Canonical address for this channel — email address or E.164. */
  identifier: string;
  phone: string | null;
  phoneVerified: boolean;
}

/**
 * Best phone for a user, preferring a verified number and falling back
 * to an unverified one on an active employee record.
 *
 * Verification is required in the SELF-SERVICE path (`resolveByIdentifier`)
 * because there the number IS the lookup key: anyone who can type a
 * phone number could otherwise point a stranger's account at their own
 * handset. That threat doesn't exist here. An admin-initiated send
 * picks the recipient by identity — a specific employee row they have
 * open — and the number is merely the address on that record, typed in
 * by the admin themselves.
 *
 * Refusing unverified numbers here would also make the common case
 * impossible: a new hire has no way to verify a phone until they can
 * sign in, and the SMS is how they sign in. Callers get `verified` back
 * so they can label the send for the admin, whose typo is now the only
 * remaining risk — the same risk that already applies to the email
 * address on the same form.
 */
async function findPhoneForUser(
  user: UserRow,
): Promise<{ phone: string; verified: boolean } | null> {
  if (user.phone && user.phone_verified_at) return { phone: user.phone, verified: true };

  const verified = await db('employees')
    .where({ user_id: user.id, status: 'active' })
    .whereNotNull('phone')
    .whereNotNull('phone_verified_at')
    .orderBy('id', 'asc')
    .first<{ phone: string }>('phone');
  if (verified) return { phone: verified.phone, verified: true };

  if (user.phone) return { phone: user.phone, verified: false };

  const unverified = await db('employees')
    .where({ user_id: user.id, status: 'active' })
    .whereNotNull('phone')
    .orderBy('id', 'asc')
    .first<{ phone: string }>('phone');
  return unverified ? { phone: unverified.phone, verified: false } : null;
}

/**
 * Self-service lookup: turn a typed-in identifier into a recipient.
 * Returns null for anything that doesn't resolve — callers must treat
 * that as a silent no-op, never as an error the caller can observe.
 */
async function resolveByIdentifier(
  identifier: string,
  channel: MagicLinkChannel,
): Promise<Recipient | null> {
  if (channel === 'email') {
    const user =
      (await db<UserRow>('users')
        .whereRaw('LOWER(email) = ?', identifier)
        .whereNull('disabled_at')
        .first()) ?? null;
    if (!user) return null;
    return {
      user,
      identifier,
      phone: user.phone,
      phoneVerified: !!user.phone_verified_at,
    };
  }

  // Look in two places: the user's own appliance-wide phone (set at
  // /preferences, used by SuperAdmins) and the employee phone
  // (per-company, set by admins or the per-company verification flow).
  // Either one must be verified to prevent a typo on an unverified
  // number from hijacking future link requests.
  const byUserPhone = await db<UserRow>('users')
    .where('phone', identifier)
    .whereNotNull('phone_verified_at')
    .whereNull('disabled_at')
    .first();
  if (byUserPhone) {
    return { user: byUserPhone, identifier, phone: identifier, phoneVerified: true };
  }

  const byEmployeePhone = await db('users')
    .join('employees', 'employees.user_id', 'users.id')
    .where('employees.phone', identifier)
    .whereNotNull('employees.phone_verified_at')
    .whereNull('users.disabled_at')
    .where('employees.status', 'active')
    .first<UserRow>('users.*');
  if (!byEmployeePhone) return null;

  // Deliver to the number that MATCHED, not `users.phone` — which is
  // usually NULL for an hourly employee.
  return { user: byEmployeePhone, identifier, phone: identifier, phoneVerified: true };
}

/** Canonicalize so the lookup, the rate-limit key, and the audit row
 *  all agree regardless of how it was typed. Email lowercases; phone
 *  coerces to E.164. Returns null for un-coercible input. */
async function canonicalizeIdentifier(
  raw: string,
  channel: MagicLinkChannel,
): Promise<string | null> {
  if (channel === 'email') return raw.trim().toLowerCase();
  const { normalizeToE164 } = await import('./notifications/phone-verification.js');
  try {
    return normalizeToE164(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Issue + deliver
// ---------------------------------------------------------------------------

interface IssueInput {
  recipient: Recipient;
  channel: MagicLinkChannel;
  purpose: LinkPurpose;
  origin: string;
  ip: string | null;
  userAgent: string | null;
  /** Set when an admin triggered this on someone else's behalf. Keeps
   *  the row out of the self-service rate-limit bucket and records who
   *  did it. */
  initiatedByUserId?: number | null;
}

interface IssueOutcome {
  status: 'sent' | 'queued' | 'skipped' | 'failed' | 'disabled';
  error: string | null;
}

/**
 * Mint a token, persist its hash, and hand the URL to the notification
 * dispatcher. Shared by every entry point so the token lifecycle and
 * audit trail can't drift between them.
 */
async function issueAndDeliver(input: IssueInput): Promise<IssueOutcome> {
  const { recipient, channel, purpose } = input;
  const { user } = recipient;

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MINUTES[purpose] * 60_000);

  await db('magic_links').insert({
    token_hash: hashToken(token),
    user_id: user.id,
    channel,
    purpose,
    identifier: recipient.identifier,
    ip: input.ip,
    user_agent: input.userAgent?.slice(0, 512) ?? null,
    initiated_by_user_id: input.initiatedByUserId ?? null,
    expires_at: expiresAt,
  });

  await recordAuthEvent({
    eventType: purpose === 'password_reset' ? 'password_reset_requested' : 'magic_link_requested',
    userId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      channel,
      purpose,
      ...(input.initiatedByUserId ? { initiatedBy: input.initiatedByUserId } : {}),
    },
  });

  // Build the callback URL. The frontend route parses ?token=... out of
  // the URL and POSTs it to /auth/magic/consume.
  const origin = input.origin.replace(/\/+$/, '');
  const url = `${origin}${LANDING_PATH[purpose]}?token=${encodeURIComponent(token)}`;

  // Pick a company for notification routing. Prefer one the user is a
  // member of (uses that company's provider config first); fall back to
  // the oldest company on the appliance so the appliance EmailIt
  // fallback still kicks in.
  const membership = await db('company_memberships')
    .where({ user_id: user.id })
    .first<{ company_id: number }>();
  let companyId = membership?.company_id ?? null;
  if (!companyId) {
    const anyCo = await db('companies').orderBy('created_at', 'asc').first<{ id: number }>();
    companyId = anyCo?.id ?? null;
  }
  if (!companyId) {
    logger.warn('link request: no company to route notification through');
    return { status: 'skipped', error: 'No company on the appliance to route the message through' };
  }

  const appName = await getResolvedDisplayName();
  const result = await notify({
    companyId,
    type: TEMPLATE[purpose],
    recipient: {
      kind: 'user',
      id: user.id,
      email: user.email,
      phone: recipient.phone,
      phoneVerified: recipient.phoneVerified,
    },
    channels: [channel],
    vars: {
      firstName: user.email.split('@')[0] ?? '',
      appName,
      [URL_VAR[purpose]]: url,
    },
  });

  const outcome = channel === 'email' ? result.email : result.sms;
  return {
    status: outcome?.status ?? 'skipped',
    error: outcome?.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Self-service entry points
// ---------------------------------------------------------------------------

/**
 * Silent no-op helper — the route returns 204 regardless of outcome.
 * Callers must NEVER expose whether the identifier existed.
 */
async function selfServiceRequest(
  input: RequestMagicLinkInput,
  purpose: LinkPurpose,
): Promise<void> {
  if (!input.identifier.trim()) return;

  const identifier = await canonicalizeIdentifier(input.identifier, input.channel);
  // Un-coercible input (too short, letters, etc.) — no-op to preserve
  // the "never reveal whether the identifier exists" posture.
  if (!identifier) return;

  try {
    const recipient = await resolveByIdentifier(identifier, input.channel);
    if (!recipient) return;

    // Rate limit: no more than N SELF-SERVICE requests for this
    // identifier per hour. Admin-initiated rows are excluded (they
    // carry initiated_by_user_id) so an admin walking a new hire
    // through setup can't exhaust that person's own recovery budget.
    //
    // The bucket is shared across purposes on purpose: they cost the
    // same to send and land in the same inbox, so letting reset have
    // its own counter would just double the spam ceiling.
    const since = new Date(Date.now() - 3600_000);
    const recentRow = await db('magic_links')
      .where({ identifier })
      .whereNull('initiated_by_user_id')
      .where('created_at', '>', since)
      .count<{ count: string }>({ count: '*' })
      .first();
    if (Number(recentRow?.count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      logger.warn({ identifier, purpose }, 'link request rate limit hit');
      return;
    }

    await issueAndDeliver({
      recipient,
      channel: input.channel,
      purpose,
      origin: input.origin,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  } catch (err) {
    logger.warn({ err, purpose }, 'link request failed (silenced to prevent enumeration)');
  }
}

/** Passwordless sign-in link. Always resolves — never throws, never
 *  reveals whether the identifier matched. */
export async function requestMagicLink(input: RequestMagicLinkInput): Promise<void> {
  return selfServiceRequest(input, 'login');
}

/** "I forgot my password". Same silence contract as requestMagicLink. */
export async function requestPasswordReset(input: RequestMagicLinkInput): Promise<void> {
  return selfServiceRequest(input, 'password_reset');
}

// ---------------------------------------------------------------------------
// Admin-initiated entry point
// ---------------------------------------------------------------------------

export interface SendAccountLinkInput {
  /** Who the link is for. */
  targetUserId: number;
  channel: MagicLinkChannel;
  purpose: LinkPurpose;
  origin: string;
  /** The admin pressing the button — recorded on the row. */
  actorUserId: number;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Send (or re-send) a sign-in or password-reset link to a user on an
 * admin's behalf. This is the missing half of the invite flow: creating
 * a membership makes an account, this is how the person is told it
 * exists.
 *
 * Reports real outcomes — see the module docblock for why the
 * anti-enumeration silence doesn't apply here. Callers are responsible
 * for having already authorized the actor against the target (company
 * admins only within their own company; SuperAdmins anywhere).
 */
export async function sendAccountLink(
  input: SendAccountLinkInput,
): Promise<SendAccountLinkResponse> {
  const user = await findUserById(input.targetUserId);
  if (!user) throw NotFound('User not found');

  let recipient: Recipient;
  let phoneUnverified = false;
  if (input.channel === 'email') {
    recipient = {
      user,
      identifier: user.email.toLowerCase(),
      phone: null,
      phoneVerified: false,
    };
  } else {
    const found = await findPhoneForUser(user);
    if (!found) {
      // A hard 400 rather than a soft "skipped" — the admin picked SMS
      // explicitly and there is no number to send to, so nothing was
      // attempted and no token was minted. Minting one we can't
      // deliver would burn a row and confuse the audit trail.
      throw BadRequest(
        'No phone number on file for this user. Add one to their employee record, or send the link by email instead.',
      );
    }
    // `phoneVerified: true` is what unblocks notify()'s SMS gate. It is
    // accurate as an authorization statement even for an unverified
    // number: the gate exists to stop sends to numbers nobody vouched
    // for, and an admin choosing this recipient from their own record
    // IS the vouching step (see findPhoneForUser). The caller still
    // learns the number was unverified via `phoneUnverified` below.
    recipient = { user, identifier: found.phone, phone: found.phone, phoneVerified: true };
    phoneUnverified = !found.verified;
  }

  const outcome = await issueAndDeliver({
    recipient,
    channel: input.channel,
    purpose: input.purpose,
    origin: input.origin,
    ip: input.ip,
    userAgent: input.userAgent,
    initiatedByUserId: input.actorUserId,
  });

  return {
    channel: input.channel,
    purpose: input.purpose,
    sentTo: maskAddress(recipient.identifier, input.channel),
    status: outcome.status,
    error: outcome.error,
    phoneUnverified,
  };
}

// ---------------------------------------------------------------------------
// Consume
// ---------------------------------------------------------------------------

export interface ConsumeMagicLinkInput {
  token: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Exchange a token for a session. Fails the same way for every error
 * case so a brute-forcer can't distinguish "wrong token" from "expired"
 * from "already consumed".
 *
 * Purpose-agnostic by design: a reset token consumed here yields the
 * same magic-link-tagged session a login token does. The difference is
 * entirely in where the link pointed — /auth/reset makes the user set a
 * password before it lets them past, /auth/magic doesn't. Nothing
 * security-relevant hinges on the distinction: both prove the same
 * thing (control of the mailbox or phone), and both already permit
 * /auth/set-password.
 */
export async function consumeMagicLink(input: ConsumeMagicLinkInput): Promise<AuthResponse> {
  const tokenHash = hashToken(input.token);

  return db.transaction(async (trx) => {
    const row = await trx('magic_links').where({ token_hash: tokenHash }).forUpdate().first<{
      id: number;
      user_id: number;
      purpose: LinkPurpose;
      expires_at: Date;
      consumed_at: Date | null;
    }>();

    if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) {
      throw Unauthorized('Invalid or expired login link');
    }

    await trx('magic_links').where({ id: row.id }).update({ consumed_at: trx.fn.now() });

    const user = await findUserById(row.user_id);
    if (!user) throw Unauthorized('Invalid or expired login link');

    // Same self-heal as password login — any employees row that
    // matches this user by email but was inserted without a user_id
    // gets linked here so the mint below reflects isEmployee=true.
    await healEmployeeLinksForUser(user.id, user.email, trx);

    const access = issueAccessToken(
      {
        id: user.id,
        email: user.email,
        roleGlobal: user.role_global,
      },
      // Tag so the /auth/set-password endpoint knows this session was
      // bootstrapped via magic-link ownership proof and can accept a
      // new password without requiring the old one.
      { authMethod: 'magic_link' },
    );
    const refresh = await issueRefreshToken(
      { userId: user.id, ip: input.ip, userAgent: input.userAgent },
      trx,
    );

    await recordAuthEvent(
      {
        eventType: 'magic_link_consumed',
        userId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: { purpose: row.purpose ?? 'login' },
      },
      trx,
    );

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      user: await buildAuthUser(user),
    };
  });
}
