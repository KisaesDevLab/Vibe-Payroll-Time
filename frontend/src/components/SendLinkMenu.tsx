// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  LinkPurpose,
  MagicLinkOptionsResponse,
  SendAccountLinkResponse,
} from '@vibept/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';

/**
 * Row-level "Send link" control, shared by the company Team page and
 * the appliance People page. Both need the identical four actions
 * (sign-in / password-reset × email / SMS) and the identical outcome
 * reporting, so the behavior lives here and each page supplies only the
 * `send` function that targets its own endpoint.
 *
 * Channel availability comes from the same public `/auth/magic/options`
 * the login page reads. An appliance with no EmailIt key and no Twilio
 * creds has no way to deliver anything, so rather than offer buttons
 * that always fail we disable them and say why — the operator's fix is
 * in Appliance settings, not on this page.
 */

interface Action {
  purpose: LinkPurpose;
  channel: 'email' | 'sms';
  label: string;
}

const ACTIONS: Action[] = [
  { purpose: 'login', channel: 'email', label: 'Email a sign-in link' },
  { purpose: 'login', channel: 'sms', label: 'Text a sign-in link' },
  { purpose: 'password_reset', channel: 'email', label: 'Email a password reset' },
  { purpose: 'password_reset', channel: 'sms', label: 'Text a password reset' },
];

export function SendLinkMenu({
  send,
  label = 'Send link',
}: {
  send: (body: {
    channel: 'email' | 'sms';
    purpose: LinkPurpose;
  }) => Promise<SendAccountLinkResponse>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SendAccountLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useQuery({
    queryKey: ['magic-options'],
    queryFn: () => apiFetch<MagicLinkOptionsResponse>('/auth/magic/options', { anonymous: true }),
    staleTime: 60_000,
    retry: false,
  });

  // Close on outside click / Escape. Without this the menu stays open
  // behind the next row's menu and two results render at once.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const mutation = useMutation({
    mutationFn: send,
    onMutate: () => {
      setResult(null);
      setError(null);
    },
    onSuccess: (data) => {
      setResult(data);
      setOpen(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not send the link.');
      setOpen(false);
    },
  });

  const available = (channel: 'email' | 'sms') =>
    channel === 'email'
      ? (options.data?.emailEnabled ?? false)
      : (options.data?.smsEnabled ?? false);

  return (
    <div className="relative inline-block text-left" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        {mutation.isPending ? 'Sending…' : `${label} ▾`}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {ACTIONS.map((a) => {
            const enabled = available(a.channel);
            return (
              <button
                key={`${a.purpose}-${a.channel}`}
                type="button"
                disabled={!enabled}
                onClick={() => mutation.mutate({ channel: a.channel, purpose: a.purpose })}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
                title={
                  enabled
                    ? undefined
                    : `No ${a.channel === 'email' ? 'email' : 'SMS'} transport is configured on this appliance`
                }
              >
                {a.label}
              </button>
            );
          })}
          {!options.data?.emailEnabled && !options.data?.smsEnabled && (
            <p className="px-3 py-2 text-xs text-slate-500">
              Configure EmailIt or an SMS provider in Appliance settings to send links.
            </p>
          )}
        </div>
      )}

      {result && <SendOutcome result={result} onDismiss={() => setResult(null)} />}
      {error && (
        <p className="mt-1 max-w-xs text-right text-xs text-red-700" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The dispatcher can succeed at the HTTP level while skipping the
 * actual send (no phone on file, provider not configured for this
 * company). Reporting those as a green "Sent!" is how an admin ends up
 * telling a new hire to check a phone that will never buzz — so the
 * skipped/failed statuses render as a warning with the reason attached.
 */
function SendOutcome({
  result,
  onDismiss,
}: {
  result: SendAccountLinkResponse;
  onDismiss: () => void;
}) {
  const delivered = result.status === 'sent' || result.status === 'queued';
  const what = result.purpose === 'password_reset' ? 'Password reset' : 'Sign-in link';

  return (
    <p
      role="status"
      onClick={onDismiss}
      className={
        'mt-1 max-w-xs cursor-pointer text-right text-xs ' +
        (delivered ? 'text-emerald-700' : 'text-amber-700')
      }
    >
      {delivered
        ? `${what} sent to ${result.sentTo}.`
        : `Not sent (${result.status})${result.error ? ` — ${result.error}` : ''}.`}
    </p>
  );
}
