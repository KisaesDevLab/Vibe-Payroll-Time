// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const factory = vi.fn(() => ({ messages: { create } }));
vi.mock('twilio', () => ({ default: factory }));

const { cleanTwilioCredential, cleanTwilioSender, sendViaTwilio, SmsDeliveryError } =
  await import('../twilio-client.js');

const MG = 'MG' + 'a'.repeat(32);

describe('Twilio client', () => {
  beforeEach(() => {
    create.mockReset();
    factory.mockClear();
    create.mockResolvedValue({ sid: 'SM123' });
  });

  it('trims pasted credentials and sends E.164 from/to', async () => {
    const res = await sendViaTwilio(
      { accountSid: ' AC1 \n', authToken: 'tok\n', fromNumber: '(414) 555-1212' },
      { to: '414.555.9999', body: 'hi' },
    );
    expect(res).toEqual({ messageId: 'SM123' });
    expect(factory).toHaveBeenCalledWith('AC1', 'tok');
    expect(create).toHaveBeenCalledWith({ from: '+14145551212', to: '+14145559999', body: 'hi' });
  });

  it('sends through a Messaging Service SID', async () => {
    await sendViaTwilio(
      { accountSid: 'AC1', authToken: 'tok', fromNumber: MG },
      { to: '+14145559999', body: 'hi' },
    );
    expect(create).toHaveBeenCalledWith({
      messagingServiceSid: MG,
      to: '+14145559999',
      body: 'hi',
    });
  });

  it("surfaces Twilio's error code with a plain-language hint", async () => {
    create.mockRejectedValue({ status: 400, code: 21608, message: 'The number is unverified.' });
    const err = await sendViaTwilio(
      { accountSid: 'AC1', authToken: 'tok', fromNumber: '+14145551212' },
      { to: '+14145559999', body: 'hi' },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect((err as Error).message).toBe(
      'Twilio 21608: The number is unverified. (trial accounts can only text numbers verified in the Twilio console)',
    );
  });

  it('refuses an unusable From number before calling Twilio', async () => {
    const err = await sendViaTwilio(
      { accountSid: 'AC1', authToken: 'tok', fromNumber: '555-1212' },
      { to: '+14145559999', body: 'hi' },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect(create).not.toHaveBeenCalled();
  });

  it('cleans settings at save time', () => {
    expect(cleanTwilioCredential('  AC1 ')).toBe('AC1');
    expect(cleanTwilioCredential('  ')).toBeNull();
    expect(cleanTwilioCredential(null)).toBeNull();
    expect(cleanTwilioSender('414-555-1212')).toBe('+14145551212');
    expect(cleanTwilioSender(` ${MG} `)).toBe(MG);
    expect(cleanTwilioSender('')).toBeNull();
    expect(() => cleanTwilioSender('12345')).toThrow();
  });
});
