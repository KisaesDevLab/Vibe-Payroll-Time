// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useQuery } from '@tanstack/react-query';
import { companies as companiesApi } from '../lib/resources';

/**
 * The company record (timezone, week start day, pay period). Same query
 * key as CompanyLayout, so pages inside the layout read the cached copy.
 * Any member, employees included, may read it.
 */
export function useCompany(companyId: number | null | undefined) {
  const valid = companyId != null && Number.isFinite(companyId) && companyId > 0;
  return useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId!),
    enabled: valid,
    staleTime: 5 * 60_000,
  });
}
