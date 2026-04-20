import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { licensing } from '../lib/resources';

/**
 * Slim in-page banner surfacing the company's license state. Quiet for
 * internal_free + licensed; amber for trial + grace; red for expired.
 * Renders nothing until we know the state so we don't flash.
 *
 * Works identically whether enforcement is actually on — the UI nags
 * before the server starts blocking, giving admins time to react.
 */
export function LicenseBanner({ companyId }: { companyId: number }) {
  const q = useQuery({
    queryKey: ['license-status', companyId],
    queryFn: () => licensing.getStatus(companyId),
    staleTime: 60_000,
  });

  if (!q.data) return null;
  const { state, daysUntilExpiry, enforced } = q.data;

  if (state === 'internal_free' || state === 'licensed') return null;

  const common = 'rounded-md border p-3 text-sm';
  const cta = (
    <a
      href="https://licensing.kisaes.com"
      target="_blank"
      rel="noreferrer"
      className="ml-2 underline"
    >
      Manage license →
    </a>
  );
  const upload = (
    <Link to={`/companies/${companyId}/license`} className="ml-2 underline">
      Upload license →
    </Link>
  );

  if (state === 'trial') {
    const days = Math.max(0, daysUntilExpiry ?? 0);
    return (
      <div className={`${common} border-amber-200 bg-amber-50 text-amber-900`}>
        <strong>Trial —</strong> {days} day{days === 1 ? '' : 's'} remaining.
        {!enforced && ' (enforcement is off on this appliance.)'}
        {cta}
        {upload}
      </div>
    );
  }
  if (state === 'grace') {
    return (
      <div className={`${common} border-amber-300 bg-amber-50 text-amber-900`}>
        <strong>License lapsed —</strong> grace period active. Data continues to be available; renew
        before the grace window ends to avoid restrictions.
        {cta}
        {upload}
      </div>
    );
  }
  // expired
  return (
    <div className={`${common} border-red-300 bg-red-50 text-red-800`}>
      <strong>License expired.</strong>{' '}
      {enforced
        ? 'New punches and edits are blocked. Read + export remain available.'
        : '(Enforcement is off on this appliance.)'}
      {cta}
      {upload}
    </div>
  );
}
