// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetch, messages } = vi.hoisted(() => {
  const fetch = vi.fn();
  const messages = Object.assign(
    vi.fn(() => ({ fetch })),
    { create: vi.fn() },
  );
  return { fetch, messages };
});
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages })) }));

const { waitForTwilioDelivery } = await import('../twilio-client.js');

const config = { accountSid: 'AC1', authToken: 'tok', fromNumber: '+14145551212' };
const fast = { intervalMs: 1, timeoutMs: 200 };

describe('waitForTwilioDelivery', () => {
  beforeEach(() => {
    vi.useRealTimers();
    fetch.mockReset();
    messages.mockClear();
  });

  it('waits until the carrier delivers', async () => {
    fetch
      .mockResolvedValueOnce({ status: 'queued', errorCode: null })
      .mockResolvedValueOnce({ status: 'sent', errorCode: null })
      .mockResolvedValueOnce({ status: 'delivered', errorCode: null });
    const d = await waitForTwilioDelivery(config, 'SM1', fast);
    expect(d).toEqual({ status: 'delivered', errorCode: null, detail: null, final: true });
    expect(messages).toHaveBeenCalledWith('SM1');
  });

  it('reports a carrier rejection with its code and a hint', async () => {
    fetch.mockResolvedValue({
      status: 'undelivered',
      errorCode: 30034,
      errorMessage: 'Message from an Unregistered Number',
    });
    const d = await waitForTwilioDelivery(config, 'SM2', fast);
    expect(d.final).toBe(true);
    expect(d.errorCode).toBe(30034);
    expect(d.detail).toContain('Twilio 30034: Message from an Unregistered Number');
    expect(d.detail).toContain('A2P 10DLC');
  });

  it('gives back the last status when it does not settle in time', async () => {
    fetch.mockResolvedValue({ status: 'sent', errorCode: null });
    const d = await waitForTwilioDelivery(config, 'SM3', { intervalMs: 5, timeoutMs: 30 });
    expect(d).toMatchObject({ status: 'sent', final: false });
  });

  it('keeps waiting through a failed lookup', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'failed', errorCode: 21608 });
    const d = await waitForTwilioDelivery(config, 'SM4', fast);
    expect(d.status).toBe('failed');
    expect(d.detail).toContain('trial accounts');
  });
});
