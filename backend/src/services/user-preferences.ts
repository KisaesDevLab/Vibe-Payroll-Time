// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { TimeFormat, UserPreferencesResponse } from '@vibept/shared';
import { resolveFormat } from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';

/**
 * Resolve the effective time format for a user across all their
 * memberships. Strategy: user preference wins; if null, fall back to
 * the first company's default the user is a member of. If the user
 * has no memberships (e.g. super_admin without one) we pick 'decimal'
 * as a safe house default.
 */
export async function getUserPreferences(userId: number): Promise<UserPreferencesResponse> {
  const user = await db('users')
    .where({ id: userId })
    .first<{ id: number; time_format_preference: TimeFormat | null }>();
  if (!user) throw NotFound('User not found');

  let companyDefault: TimeFormat = 'decimal';
  const membership = await db('company_memberships as m')
    .join('company_settings as s', 's.company_id', 'm.company_id')
    .where('m.user_id', userId)
    .orderBy('m.created_at', 'asc')
    .first<{ time_format_default: TimeFormat }>('s.time_format_default');
  if (membership?.time_format_default) companyDefault = membership.time_format_default;

  return {
    timeFormatPreference: user.time_format_preference,
    timeFormatEffective: resolveFormat(user.time_format_preference, companyDefault),
  };
}

export async function updateUserPreferences(
  userId: number,
  patch: { timeFormatPreference: TimeFormat | null },
): Promise<UserPreferencesResponse> {
  await db('users').where({ id: userId }).update({
    time_format_preference: patch.timeFormatPreference,
  });
  return getUserPreferences(userId);
}
