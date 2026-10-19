// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useSyncExternalStore } from 'react';
import { authStore, type StoredSession } from '../lib/auth-store';

export function useSession(): StoredSession | null {
  return useSyncExternalStore(
    (fn) => authStore.subscribe(fn),
    () => authStore.get(),
    () => null,
  );
}
