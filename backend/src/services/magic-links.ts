import crypto from 'node:crypto';
import type { AuthResponse, MagicLinkOptionsResponse } from '@vibept/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';
import { Unauthorized } from '../http/errors.js';
import { getResolvedEmailit, getResolvedSmsProvider } from './appliance-settings.js';
import { recordAuthEvent } from './auth-events.js';
import { buildAuthUser } from './auth.js';
import { notify } from './notifications/service.js';
import { issueAccessToken, issueRefreshToken } from './tokens.js';
import { findUserById, type UserRow } from './users.js';

/**
 * Passwordless login. One endpoint mints a token + emails/texts a link;
 * another consumes the token and issues a session.
 *
 * Security posture:
 *   - `requestMagicLink` never reveals whether an identifier exists —
 *     returns 204 on both hit and miss. Rate-limited to 3 requests per
 *     identifier per hour.
 *   - Only the token HASH lives in the DB. A DB dump alone can't log
 *     anyone in.
 *   - Tokens are 32 random bytes (256-bit) base64url, single-use, 15-min
 *     expiry.
 *   - Every request + consume writes an auth_events row for audit.
 *
 * v1 constraint: only works for existing `users` rows. Employees
 * without a user account can't use magic link yet; that needs a
 * separate invite-with-magic-first flow.
 */

const TOKEN_BYTES = 32;
const TTL_MINUTES = 15;
const RATE_LIMIT_PER_HOUR = 3;

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
 * Silent no-op helper — returns 204 regardless of outcome. Callers
 * should NEVER expose whether the identifier existed.
 */
export async function requestMagicLink(input: RequestMagicLinkInput): Promise<void> {
  if (!input.identifier.trim()) return;

  // Canonicalize the identifier so the lookup, the rate-limit key, and
  // the audit row all agree — regardless of how the operator typed it
  // at the login page. For email: lowercase. For phone: E.164.
  let identifier: string;
  if (input.channel === 'email') {
    identifier = input.identifier.trim().toLowerCase();
  } else {
    const { normalizeToE164 } = await import('./notifications/phone-verification.js');
    try {
      identifier = normalizeToE164(input.identifier);
    } catch {
      // Un-coercible input (too short, letters, etc.) — no-op to
      // preserve the "never reveal whether the identifier exists"
      // posture.
      return;
    }
  }

  try {
    // Find the user for this identifier.
    let user: UserRow | null = null;
    if (input.channel === 'email') {
      user =
        (await db<UserRow>('users')
          .whereRaw('LOWER(email) = ?', identifier)
          .whereNull('disabled_at')
          .first()) ?? null;
    } else {
      // Look in two places: the user's own appliance-wide phone (set
      // at /preferences, used by SuperAdmins) and the employee phone
      // (per-company, set by admins or the per-company verification
      // flow). Either one must be verified to prevent a typo on an
      // unverified number from hijacking future magic-link requests.
      const byUserPhone = await db<UserRow>('users')
        .where('phone', identifier)
        .whereNotNull('phone_verified_at')
        .whereNull('disabled_at')
        .first();
      if (byUserPhone) {
        user = byUserPhone;
      } else {
        const row = await db('users')
          .join('employees', 'employees.user_id', 'users.id')
          .where('employees.phone', identifier)
          .whereNotNull('employees.phone_verified_at')
          .whereNull('users.disabled_at')
          .where('employees.status', 'active')
          .first<UserRow>('users.*');
        user = row ?? null;
      }
    }
    if (!user) return;

    // Rate limit: no more than N requests for this identifier per hour.
    const since = new Date(Date.now() - 3600_000);
    const recentRow = await db('magic_links')
      .where({ identifier })
      .where('created_at', '>', since)
      .count<{ count: string }>({ count: '*' })
      .first();
    const recent = Number(recentRow?.count ?? 0);
    if (recent >= RATE_LIMIT_PER_HOUR) {
      logger.warn({ identifier }, 'magic link rate limit hit');
      return;
    }

    // Generate token + hash + expiry.
    const tokenBuf = crypto.randomBytes(TOKEN_BYTES);
    const token = tokenBuf.toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

    await db('magic_links').insert({
      token_hash: tokenHash,
      user_id: user.id,
      channel: input.channel,
      identifier,
      ip: input.ip,
      user_agent: input.userAgent?.slice(0, 512) ?? null,
      expires_at: expiresAt,
    });

    await recordAuthEvent({
      eventType: 'magic_link_requested',
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { channel: input.channel },
    });

    // Build the callback URL. The frontend's /auth/magic route parses
    // ?token=... out of the URL and POSTs to /auth/magic/consume.
    const origin = input.origin.replace(/\/+$/, '');
    const magicUrl = `${origin}/auth/magic?token=${encodeURIComponent(token)}`;

    // Pick a company for notification routing. Prefer one the user is
    // a member of (uses that company's provider config first); fall
    // back to the oldest company on the appliance so the appliance
    // EmailIt fallback still kicks in.
    const membership = await db('company_memberships')
      .where({ user_id: user.id })
      .first<{ company_id: number }>();
    let companyId = membership?.company_id ?? null;
    if (!companyId) {
      const anyCo = await db('companies').orderBy('created_at', 'asc').first<{ id: number }>();
      companyId = anyCo?.id ?? null;
    }
    if (!companyId) {
      logger.warn('magic link: no company to route notification through');
      return;
    }

    await notify({
      companyId,
      type: 'magic_link',
      recipient: {
        kind: 'user',
        id: user.id,
        email: user.email,
        // Expose the user-level phone + verification flag so the SMS
        // branch of notify() can route the magic link for SuperAdmins
        // who only have a user-level phone (no employee record).
        phone: user.phone,
        phoneVerified: !!user.phone_verified_at,
      },
      channels: [input.channel],
      vars: {
        firstName: user.email.split('@')[0] ?? '',
        appName: env.APPLIANCE_ID,
        magicUrl,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'magic link request failed (silenced to prevent enumeration)');
  }
}

export interface ConsumeMagicLinkInput {
  token: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Exchange a token for a session. Fails the same way for every error
 * case so a brute-forcer can't distinguish "wrong token" from "expired"
 * from "already consumed".
 */
export async function consumeMagicLink(input: ConsumeMagicLinkInput): Promise<AuthResponse> {
  const tokenHash = hashToken(input.token);

  return db.transaction(async (trx) => {
    const row = await trx('magic_links').where({ token_hash: tokenHash }).forUpdate().first<{
      id: number;
      user_id: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>();

    if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) {
      throw Unauthorized('Invalid or expired login link');
    }

    await trx('magic_links').where({ id: row.id }).update({ consumed_at: trx.fn.now() });

    const user = await findUserById(row.user_id);
    if (!user) throw Unauthorized('Invalid or expired login link');

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
