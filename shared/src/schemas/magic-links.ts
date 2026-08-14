// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

/**
 * Login options surfaced to the LoginPage BEFORE any auth — tells the
 * UI which magic-link channels the appliance has transports for. An
 * operator who hasn't configured EmailIt or Twilio sees only the
 * password form; once they do, the buttons light up.
 */
export const magicLinkOptionsResponseSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
});
export type MagicLinkOptionsResponse = z.infer<typeof magicLinkOptionsResponseSchema>;

/** Request a link. `identifier` is an email for channel=email, phone
 *  for channel=sms. Server returns 204 regardless of whether a user
 *  matches — no enumeration leaks.
 *
 *  `origin` (optional) is the frontend's own origin (`window.location.origin`).
 *  When present the server uses it to build the magic-link URL so the
 *  link points at the frontend, not the backend — matters when the
 *  two are on different ports (dev) or hostnames (reverse-proxy
 *  edge cases). Always validated against a whitelist derived from
 *  `CORS_ORIGIN` to prevent an attacker from minting a token with a
 *  malicious callback domain. */
export const magicLinkRequestSchema = z.object({
  identifier: z.string().min(3).max(254),
  channel: z.enum(['email', 'sms']),
  origin: z.string().url().max(512).optional(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Exchange a token for a session. Token comes out of the
 *  ?token=... query param on the /auth/magic landing page. */
export const magicLinkConsumeRequestSchema = z.object({
  token: z.string().min(16).max(128),
});
export type MagicLinkConsumeRequest = z.infer<typeof magicLinkConsumeRequestSchema>;

/** What a single-use token is for. Drives TTL (15m login / 30m reset),
 *  which notification template renders, and which frontend route the
 *  emailed URL points at. */
export const linkPurposeSchema = z.enum(['login', 'password_reset']);
export type LinkPurpose = z.infer<typeof linkPurposeSchema>;

/** Self-service "I forgot my password". Same anti-enumeration posture
 *  as `magicLinkRequestSchema` — always 204, never confirms the
 *  identifier exists. Deliberately a separate endpoint from
 *  /auth/magic/request so the audit trail distinguishes "wanted to sign
 *  in" from "wanted to change credentials". */
export const passwordResetRequestSchema = magicLinkRequestSchema;
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

// ---------------------------------------------------------------------------
// Admin-initiated sends
// ---------------------------------------------------------------------------

/** A CompanyAdmin (Team page) or SuperAdmin (People page) sending a
 *  sign-in or password-reset link on someone else's behalf — the
 *  "I created your account, here's how to get in" path, and the
 *  "resend it, they never got the first one" path.
 *
 *  Unlike the self-service endpoints this one reports real outcomes:
 *  the caller is an authenticated admin who already knows the account
 *  exists, so there is nothing to enumerate, and silently swallowing
 *  "no phone on file" would leave the admin waiting on a text that is
 *  never coming. */
export const sendAccountLinkRequestSchema = z.object({
  channel: z.enum(['email', 'sms']),
  purpose: linkPurposeSchema.default('login'),
  origin: z.string().url().max(512).optional(),
});
export type SendAccountLinkRequest = z.infer<typeof sendAccountLinkRequestSchema>;

/** Delivery outcome, mirroring the notifications-log statuses so the
 *  admin UI can say "sent" vs "skipped — phone not verified" rather
 *  than a bare success toast. */
export const sendAccountLinkResponseSchema = z.object({
  channel: z.enum(['email', 'sms']),
  purpose: linkPurposeSchema,
  /** Address the link went to, redacted to a hint (`j••@example.com`,
   *  `•••-••12`) — enough for the admin to confirm they picked the
   *  right person without exposing a full number they didn't already
   *  have access to. */
  sentTo: z.string(),
  status: z.enum(['sent', 'queued', 'skipped', 'failed', 'disabled']),
  /** Present when status is skipped/failed. Operator-facing text. */
  error: z.string().nullable(),
  /** True when the SMS went to a number nobody has confirmed yet —
   *  normal for a new hire, who can't verify a phone until they can
   *  sign in. Surfaced so the admin double-checks the digits, since a
   *  typo here delivers a working sign-in link to a stranger. */
  phoneUnverified: z.boolean().default(false),
});
export type SendAccountLinkResponse = z.infer<typeof sendAccountLinkResponseSchema>;

/** Same send, triggered from an employee record rather than a team
 *  membership. An employee row may have no linked user account at all
 *  (the kiosk-only case), so this variant can provision one first. */
export const sendEmployeeLinkRequestSchema = sendAccountLinkRequestSchema.extend({
  /** Create a web-login account for this employee if they don't have
   *  one, then send the link. Requires an email address on the record.
   *  Off by default — provisioning a login is a real authorization
   *  decision and must be an explicit click, never a side effect of
   *  pressing "send". */
  createLogin: z.boolean().optional().default(false),
});
export type SendEmployeeLinkRequest = z.infer<typeof sendEmployeeLinkRequestSchema>;

/** Adds whether an account had to be created, so the UI can say "login
 *  created and link sent" rather than just "link sent". */
export const sendEmployeeLinkResponseSchema = sendAccountLinkResponseSchema.extend({
  loginCreated: z.boolean(),
});
export type SendEmployeeLinkResponse = z.infer<typeof sendEmployeeLinkResponseSchema>;
