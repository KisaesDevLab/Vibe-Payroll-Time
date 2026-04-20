import { useSyncExternalStore } from 'react';
import { kioskStore, type StoredKiosk } from '../lib/kiosk-store';

export function useKiosk(): StoredKiosk | null {
  return useSyncExternalStore(
    (fn) => kioskStore.subscribe(fn),
    () => kioskStore.get(),
    () => null,
  );
}
