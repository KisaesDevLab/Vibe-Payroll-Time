// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Navigate } from 'react-router-dom';
import { useKiosk } from '../../hooks/useKiosk';
import { isSecureContext } from '../../lib/secure-context';
import { KioskPinPage } from './KioskPinPage';

/**
 * Top-level kiosk component. Renders the PIN keypad if this tablet is
 * already paired; otherwise redirects to the pair flow. Fullscreen by
 * design — no TopBar, no navigation shell.
 *
 * Phase 14.3 — over plain HTTP (the appliance's emergency-access
 * fallback at :5192) the kiosk simply does not work. Service workers
 * won't register, the camera API is gated, and the PWA install prompt
 * silently fails. Render an explainer page instead of silently
 * letting the operator hit a series of inscrutable browser errors
 * after each tap.
 */
export function KioskRoot() {
  // Hook order must be stable across renders — call useKiosk
  // unconditionally and gate the rendered output afterwards. The
  // hook's reads are cheap (sessionStorage), so doing them in the
  // insecure-context case is fine.
  const kiosk = useKiosk();
  if (!isSecureContext()) return <KioskInsecureContextPage />;
  if (!kiosk) return <Navigate to="/kiosk/pair" replace />;
  return <KioskPinPage />;
}

function KioskInsecureContextPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#0f172a',
        color: '#f1f5f9',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: 560, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>Kiosk mode requires HTTPS</h1>
        <p style={{ marginBottom: '1rem' }}>
          You're loading this page over an unsecured connection. Wall-mounted kiosks need a secure
          (https://) URL because the offline punch queue, camera-based QR scanning, and PWA install
          all require a secure context.
        </p>
        <p style={{ marginBottom: '1rem' }}>
          If you're a staff member doing emergency time-card review while the primary URL is down,
          you can use the manager and employee pages on this connection — kiosk mode is the only
          screen that needs HTTPS.
        </p>
        <p style={{ marginBottom: '0' }}>
          For the kiosk tablet, switch back to the firm's primary URL or the Tailscale URL the
          operator gave you. Bookmark that one — never the emergency URL.
        </p>
      </div>
    </div>
  );
}
