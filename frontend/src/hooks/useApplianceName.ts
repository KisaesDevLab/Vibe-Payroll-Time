// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import type { ApplianceInfoResponse } from '@vibept/shared';
import { apiFetch } from '../lib/api';

/**
 * The appliance's display name — operator-customizable via SuperAdmin
 * settings. Cached for the lifetime of the session since it changes
 * rarely. Public endpoint (no auth) so the login page can read it too.
 *
 * Falls back to the product default while the query is in flight so
 * the TopBar never renders blank.
 */
export function useApplianceName(): string {
  const q = useQuery({
    queryKey: ['appliance-info'],
    queryFn: () => apiFetch<ApplianceInfoResponse>('/appliance/info'),
    staleTime: 5 * 60_000,
  });
  return q.data?.displayName ?? 'Vibe Payroll Time';
}
