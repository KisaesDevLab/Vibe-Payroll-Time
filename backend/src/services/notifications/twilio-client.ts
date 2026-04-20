import twilio from 'twilio';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsSendResult {
  messageId: string;
}

export class SmsDeliveryError extends Error {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    if (status !== undefined) this.status = status;
  }
}

/**
 * Per-send client — instantiate with decrypted credentials, send, let
 * the client drop out of scope. Twilio SDK handles connection reuse
 * internally when the same config is seen repeatedly; for our
 * infrequent send volume this is a non-issue.
 */
export async function sendViaTwilio(
  config: TwilioConfig,
  payload: SmsPayload,
): Promise<SmsSendResult> {
  const client = twilio(config.accountSid, config.authToken);
  try {
    const message = await client.messages.create({
      from: config.fromNumber,
      to: payload.to,
      body: payload.body,
    });
    return { messageId: message.sid };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    throw new SmsDeliveryError(
      e.message ?? 'Twilio send failed',
      e.status,
    );
  }
}
