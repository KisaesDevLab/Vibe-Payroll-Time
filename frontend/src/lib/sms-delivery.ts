// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * One line for a successful test SMS. Twilio reports the carrier's
 * verdict ("delivered"), or that it was still in flight when the test
 * stopped waiting, in which case the phone is the final word.
 */
export function deliveryLabel(
  provider: string | null,
  delivery: { status: string; final: boolean } | null | undefined,
): string {
  const via = provider ?? 'provider';
  if (!delivery) return `Sent via ${via}`;
  if (delivery.status === 'delivered' || delivery.status === 'read') {
    return `Delivered via ${via}`;
  }
  return `Accepted by ${via} (status: ${delivery.status}); the carrier hasn't confirmed delivery yet — check the phone`;
}
