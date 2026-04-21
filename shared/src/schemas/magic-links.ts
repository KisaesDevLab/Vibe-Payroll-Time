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
