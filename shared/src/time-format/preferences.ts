import type { TimeFormat } from '../enums.js';

/**
 * Resolve the effective display format. User preference wins when set;
 * company default applies when user hasn't expressed one. Both are
 * cosmetic — storage never uses formatted strings.
 */
export function resolveFormat(
  userPreference: TimeFormat | null | undefined,
  companyDefault: TimeFormat,
): TimeFormat {
  return userPreference ?? companyDefault;
}
