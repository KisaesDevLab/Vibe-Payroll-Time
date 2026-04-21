// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import type { SetupStatusResponse } from '@vibept/shared';
import { apiFetch } from '../lib/api';

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => apiFetch<SetupStatusResponse>('/setup/status', { anonymous: true }),
    staleTime: 30_000,
  });
}
