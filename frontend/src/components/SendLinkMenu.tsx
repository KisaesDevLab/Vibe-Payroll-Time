// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  LinkPurpose,
  MagicLinkOptionsResponse,
  SendAccountLinkResponse,
} from '@vibept/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 *
 * The menu renders in a portal with fixed positioning: the tables it sits
 * in clip their overflow (rounded cards), which cut the menu off on the
 * last rows. It opens below the button, or above it when there isn't room.
 */

const MENU_WIDTH = 256; // w-64
const MENU_GAP = 4;

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
  smsTo,
}: {
  send: (body: {
    channel: 'email' | 'sms';
    purpose: LinkPurpose;
  }) => Promise<SendAccountLinkResponse>;
  label?: string;
  /** The number texts will go to, shown on the text options so the admin
   *  sees it before sending. Omit when the page doesn't know it. */
  smsTo?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SendAccountLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Place the menu against the button, flipping above it when it would
  // run off the bottom of the viewport. Measured after render so the
  // menu's real height is known.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const button = buttonRef.current?.getBoundingClientRect();
    if (!button) return;
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = button.bottom + MENU_GAP;
    const top =
      below + height > window.innerHeight && button.top - MENU_GAP - height > 0
        ? button.top - MENU_GAP - height
        : below;
    const left = Math.max(
      8,
      Math.min(button.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    );
    setPos({ top, left });
  }, [open]);

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
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // A fixed-position menu would drift away from its button on scroll.
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
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
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        {mutation.isPending ? 'Sending…' : `${label} ▾`}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            // Hidden for the one frame before it is measured and placed.
            style={
              pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
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
                  {a.channel === 'sms' && smsTo && (
                    <span className="block text-xs text-slate-500">to {smsTo}</span>
                  )}
                </button>
              );
            })}
            {!options.data?.emailEnabled && !options.data?.smsEnabled && (
              <p className="px-3 py-2 text-xs text-slate-500">
                Configure EmailIt or an SMS provider in Appliance settings to send links.
              </p>
            )}
          </div>,
          document.body,
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
