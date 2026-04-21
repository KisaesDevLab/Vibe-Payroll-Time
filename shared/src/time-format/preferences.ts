// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
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
