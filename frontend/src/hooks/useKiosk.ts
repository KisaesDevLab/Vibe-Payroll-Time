// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useSyncExternalStore } from 'react';
import { kioskStore, type StoredKiosk } from '../lib/kiosk-store';

export function useKiosk(): StoredKiosk | null {
  return useSyncExternalStore(
    (fn) => kioskStore.subscribe(fn),
    () => kioskStore.get(),
    () => null,
  );
}
