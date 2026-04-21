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
 *  matches — no enumeration leaks. */
export const magicLinkRequestSchema = z.object({
  identifier: z.string().min(3).max(254),
  channel: z.enum(['email', 'sms']),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Exchange a token for a session. Token comes out of the
 *  ?token=... query param on the /auth/magic landing page. */
export const magicLinkConsumeRequestSchema = z.object({
  token: z.string().min(16).max(128),
});
export type MagicLinkConsumeRequest = z.infer<typeof magicLinkConsumeRequestSchema>;
