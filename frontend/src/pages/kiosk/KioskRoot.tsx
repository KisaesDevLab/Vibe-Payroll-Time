// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Navigate } from 'react-router-dom';
import { useKiosk } from '../../hooks/useKiosk';
import { KioskPinPage } from './KioskPinPage';

/**
 * Top-level kiosk component. Renders the PIN keypad if this tablet is
 * already paired; otherwise redirects to the pair flow. Fullscreen by
 * design — no TopBar, no navigation shell.
 */
export function KioskRoot() {
  const kiosk = useKiosk();
  if (!kiosk) return <Navigate to="/kiosk/pair" replace />;
  return <KioskPinPage />;
}
