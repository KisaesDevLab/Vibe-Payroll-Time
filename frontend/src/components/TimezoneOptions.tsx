// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * IANA timezone dropdown options. Primary data source is
 * `Intl.supportedValuesOf('timeZone')` (Chromium / modern Node), which
 * returns the full IANA list the runtime actually knows how to
 * interpret. Fallback is a hand-picked subset covering North America
 * + common international zones so the dropdown still works on engines
 * that haven't implemented the API yet.
 *
 * Common US zones are pinned to the top of the list so CPA-firm
 * operators (the primary users) don't have to scroll past
 * Africa/Abidjan on every page load.
 */

const PINNED = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

const FALLBACK: string[] = [
  ...PINNED,
  'America/Puerto_Rico',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function listZones(): string[] {
  type IntlWithValues = { supportedValuesOf?: (key: 'timeZone') => string[] };
  const maybe = (Intl as unknown as IntlWithValues).supportedValuesOf;
  if (typeof maybe === 'function') {
    try {
      return maybe.call(Intl, 'timeZone');
    } catch {
      return FALLBACK;
    }
  }
  return FALLBACK;
}

export function TimezoneOptions({ current }: { current: string }): JSX.Element {
  const all = listZones();
  // Ensure the currently-selected timezone is always in the list even
  // if the browser's Intl DB doesn't know it (e.g., a custom IANA alias
  // someone typed before this dropdown shipped).
  const set = new Set([...PINNED, ...all]);
  if (current) set.add(current);
  // Split: pinned-set first (in canonical order), then the rest
  // alphabetized.
  const pinned = PINNED.filter((z) => set.has(z));
  const rest = [...set].filter((z) => !PINNED.includes(z)).sort();
  return (
    <>
      <optgroup label="Common US / UTC">
        {pinned.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </optgroup>
      <optgroup label="All timezones">
        {rest.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </optgroup>
    </>
  );
}
