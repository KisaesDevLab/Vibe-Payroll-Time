// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
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
