// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AiRouterHealth } from '../lib/resources';

/**
 * Body of the "AI Router" card on the appliance dashboard. The registration
 * loop fails closed and only warns in the logs, so this card is where a
 * wrong-identity token (permanent 403) becomes visible to the operator.
 */
export function AiRouterCard({ aiRouter }: { aiRouter: AiRouterHealth }) {
  if (aiRouter.mode === 'direct') {
    return <p className="text-slate-500">direct mode — router not in use</p>;
  }

  const { registration } = aiRouter;

  if (registration.status === 'registered') {
    return (
      <>
        <p className="text-emerald-700">registered</p>
        {registration.registeredAt && (
          <p className="text-xs text-slate-500">
            since {new Date(registration.registeredAt).toLocaleString()}
          </p>
        )}
      </>
    );
  }

  if (registration.status === 'failing') {
    const err = registration.lastError;
    const authFailure = err?.status === 401 || err?.status === 403;
    return (
      <>
        <p className="text-red-700">registration failing</p>
        <p className="text-xs text-slate-500">
          attempt {registration.attempts}
          {registration.lastAttemptAt &&
            `, last ${new Date(registration.lastAttemptAt).toLocaleString()}`}
        </p>
        {err && (
          <p className="mt-1 text-xs text-red-700">
            {err.status !== null ? `HTTP ${err.status} — ` : ''}
            {err.code ? `${err.code}: ` : ''}
            {err.message}
          </p>
        )}
        {authFailure && (
          <p className="mt-1 text-xs text-slate-600">
            Check token identity — VIBE_AI_TOKEN must be minted for &lsquo;vibe-payroll-time&rsquo;.
          </p>
        )}
      </>
    );
  }

  // 'pending' (first attempt in flight); 'disabled' can't happen in router mode
  return (
    <>
      <p className="text-amber-700">registering…</p>
      <p className="text-xs text-slate-500">attempt {registration.attempts}</p>
    </>
  );
}
