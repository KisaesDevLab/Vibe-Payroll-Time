/**
 * Client clock skew tracker.
 *
 * The server stamps authoritative timestamps on every punch, but offline
 * punches can only carry the client's sense of time. We periodically ping
 * the server (existing /health endpoint — minimal payload, always up) and
 * measure skew = serverTime - clientTime, adjusted for half the round-trip.
 *
 * The adjusted skew is added to `Date.now()` when queuing an offline
 * punch so the server can reconstruct a UTC timestamp for
 * `client_started_at`.
 */

const STORAGE_KEY = 'vibept.clock-skew-ms';
const PING_INTERVAL_MS = 5 * 60_000; // every 5 minutes while online

let currentSkewMs = 0;

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStored(skew: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(skew));
  } catch {
    // ignore (private browsing etc.)
  }
}

export function getClockSkewMs(): number {
  return currentSkewMs;
}

/** Best-effort skew measurement. Silent failures are fine — 0 is a
 *  defensible fallback and the server clamps timestamps to NOW(). */
export async function measureSkew(): Promise<number> {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  const t0 = Date.now();
  try {
    const res = await fetch(`${apiBase}/health`, { method: 'GET' });
    if (!res.ok) return currentSkewMs;
    const body = (await res.json().catch(() => null)) as { data?: { timestamp?: string } } | null;
    const t1 = Date.now();
    const serverIso = body?.data?.timestamp;
    if (!serverIso) return currentSkewMs;
    const serverMs = new Date(serverIso).getTime();
    if (!Number.isFinite(serverMs)) return currentSkewMs;

    // Mid-point heuristic: assume request and response each took half the
    // round-trip. Good enough — the server's 72-hour window is forgiving.
    const roundTrip = t1 - t0;
    const clientMid = t0 + roundTrip / 2;
    const skew = Math.round(serverMs - clientMid);

    currentSkewMs = skew;
    writeStored(skew);
    return skew;
  } catch {
    return currentSkewMs;
  }
}

/** Kick off periodic measurement. Returns a stop function. */
export function startSkewLoop(): () => void {
  currentSkewMs = readStored();
  if (typeof window === 'undefined') return () => undefined;

  void measureSkew();
  const id = window.setInterval(() => void measureSkew(), PING_INTERVAL_MS);
  const onOnline = () => void measureSkew();
  window.addEventListener('online', onOnline);
  return () => {
    window.clearInterval(id);
    window.removeEventListener('online', onOnline);
  };
}
