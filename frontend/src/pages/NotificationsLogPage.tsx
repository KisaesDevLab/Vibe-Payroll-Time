// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import type { NotificationsLogRow } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { notifications } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

const STATUS_ORDER: Array<NotificationsLogRow['status'] | 'all'> = [
  'all',
  'queued',
  'sent',
  'failed',
  'skipped',
  'disabled',
];

export function NotificationsLogPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const [status, setStatus] = useState<(typeof STATUS_ORDER)[number]>('all');
  const [channel, setChannel] = useState<'all' | 'email' | 'sms'>('all');

  const list = useQuery({
    queryKey: ['notifications-log', companyId, status, channel],
    queryFn: () =>
      notifications.log(companyId, {
        ...(status !== 'all' ? { status } : {}),
        ...(channel !== 'all' ? { channel } : {}),
        limit: 200,
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Notifications log</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every email and SMS the appliance has tried to send for this company.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUS_ORDER)[number])}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
          >
            <option value="all">all channels</option>
            <option value="email">email</option>
            <option value="sms">sms</option>
          </select>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">When</th>
              <th className="px-4 py-2 text-left font-medium">Channel</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Recipient</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Provider / error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.isPending && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!list.isPending &&
              list.data?.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-xs">{new Date(r.queuedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs uppercase">{r.channel}</td>
                  <td className="px-4 py-2">{r.type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-xs">{r.recipientAddress || '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' + badgeClass(r.status)
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {r.error ? (
                      <span className="text-red-700">{r.error}</span>
                    ) : r.providerMessageId ? (
                      <code className="text-[11px]">{r.providerMessageId}</code>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            {!list.isPending && list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No notifications match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function badgeClass(status: NotificationsLogRow['status']): string {
  switch (status) {
    case 'sent':
      return 'bg-emerald-100 text-emerald-800';
    case 'queued':
      return 'bg-amber-100 text-amber-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'skipped':
      return 'bg-slate-200 text-slate-700';
    case 'disabled':
      return 'bg-slate-100 text-slate-500';
  }
}
