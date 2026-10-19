// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useQuery } from '@tanstack/react-query';
import { ai } from '../lib/resources';

/**
 * Whether the AI cards (support chat, "Ask assistant") should show for a
 * company: AI switched on there and something configured to answer. Any
 * member may ask. False while loading or on any error, so a card never
 * flashes up and then errors on use.
 */
export function useAIAvailable(companyId: number | null | undefined): boolean {
  const q = useQuery({
    queryKey: ['ai-availability', companyId],
    queryFn: () => ai.availability(companyId!),
    enabled: companyId != null,
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.available === true;
}
