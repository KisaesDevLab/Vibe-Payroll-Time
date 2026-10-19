// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from './useSession';

const storageKey = (userId: number) => `vibept:punch-company:${userId}`;

function readRemembered(userId: number | undefined): number | null {
  if (userId == null) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function remember(userId: number | undefined, companyId: number): void {
  if (userId == null) return;
  try {
    window.localStorage.setItem(storageKey(userId), String(companyId));
  } catch {
    /* private window / blocked storage — the picker still works */
  }
}

/**
 * The company a person is punching for on /my-punch and /my-timesheet.
 *
 * Only memberships with an employee record count (an admin-only
 * membership has no clock). The choice is remembered per user in this
 * browser, so someone who works for two companies lands on the one they
 * used last instead of whichever sorts first; a remembered company they
 * no longer belong to falls back to the first.
 */
export function usePunchCompany() {
  const session = useSession();
  const userId = session?.user.id;
  const memberships = useMemo(
    () => session?.user.memberships.filter((m) => m.isEmployee) ?? [],
    [session],
  );

  const pick = useCallback(
    (preferred: number | null): number | null =>
      memberships.some((m) => m.companyId === preferred)
        ? preferred
        : (memberships[0]?.companyId ?? null),
    [memberships],
  );

  const [companyId, setState] = useState<number | null>(() => pick(readRemembered(userId)));
  useEffect(() => {
    // Memberships arrive or change (session refresh): keep a valid choice.
    setState((cur) => pick(cur ?? readRemembered(userId)));
  }, [pick, userId]);

  const setCompanyId = useCallback(
    (id: number) => {
      setState(id);
      remember(userId, id);
    },
    [userId],
  );

  const company = memberships.find((m) => m.companyId === companyId) ?? null;
  return { memberships, companyId, setCompanyId, company };
}
