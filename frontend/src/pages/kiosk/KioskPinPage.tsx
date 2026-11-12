// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery } from '@tanstack/react-query';
import type { KioskEmployeeContext, TimeFormat } from '@vibept/shared';
import {
  KIOSK_IDLE_LOCK_SECONDS,
  KIOSK_LUNCH_PROMPT_SECONDS,
  formatHours,
  type KioskClockOutRequest,
} from '@vibept/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeScanner } from '../../components/BadgeScanner';
import { useKiosk } from '../../hooks/useKiosk';
import { ApiError } from '../../lib/api';
import { isKioskUnreachable, kioskApi } from '../../lib/kiosk-api';
import { kioskStore } from '../../lib/kiosk-store';
import { KioskButton } from './kiosk-ui';

type AuthMode = 'pin' | 'qr' | 'both';
type Screen = 'pin' | 'scan' | 'menu' | 'lunch' | 'confirmation' | 'offline';

const PIN_LEN_MIN = 4;
const PIN_LEN_MAX = 6;
const CONFIRM_SECONDS = 10;
const UNPAIR_WORD = 'UNPAIR';

/** "7.75 hrs worked today" / "7:45 worked today" in the company's format. */
function workedToday(seconds: number, format: TimeFormat): string {
  const value = formatHours(seconds, format);
  return format === 'hhmm' ? `${value} worked today` : `${value} hrs worked today`;
}

function clockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function KioskPinPage() {
  const kiosk = useKiosk();

  // Fetch auth mode from the server so an admin flipping it propagates
  // without a re-pair. Falls back to the store's cached value.
  const meQuery = useQuery({
    queryKey: ['kiosk', 'me'],
    queryFn: () => kioskApi.me(),
    enabled: !!kiosk,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const authMode: AuthMode = meQuery.data?.kioskAuthMode ?? kiosk?.kioskAuthMode ?? 'pin';

  // Persist the live settings back to the store so a reload (even one
  // that can't reach the server) renders with them.
  useEffect(() => {
    if (!kiosk || !meQuery.data) return;
    const { kioskAuthMode, timeFormat, lunchPromptEnabled } = meQuery.data;
    if (
      kiosk.kioskAuthMode === kioskAuthMode &&
      kiosk.timeFormat === timeFormat &&
      kiosk.lunchPromptEnabled === lunchPromptEnabled
    ) {
      return;
    }
    kioskStore.set({ ...kiosk, kioskAuthMode, timeFormat, lunchPromptEnabled });
  }, [kiosk, meQuery.data]);

  // A shared tablet has no user preference: the company default applies.
  const timeFormat: TimeFormat = meQuery.data?.timeFormat ?? kiosk?.timeFormat ?? 'decimal';
  // Only ask about lunch when the company setting is KNOWN to be on —
  // never while it is loading or failed to load.
  const lunchPromptEnabled =
    (meQuery.data?.lunchPromptEnabled ?? kiosk?.lunchPromptEnabled) === true;

  const defaultScreen: Screen = authMode === 'pin' ? 'pin' : 'scan';

  const [screen, setScreen] = useState<Screen>(defaultScreen);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<KioskEmployeeContext | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmCountdown, setConfirmCountdown] = useState(CONFIRM_SECONDS);
  const [scanFlash, setScanFlash] = useState(false);
  const [confirmDetail, setConfirmDetail] = useState<string | null>(null);
  const [offlineInfo, setOfflineInfo] = useState<{ at: Date; action: string | null } | null>(null);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const scanInFlight = useRef(false);
  // When the employee tapped — shown on the offline screen so they can
  // report the time to a supervisor.
  const attemptRef = useRef<{ at: Date; action: string | null }>({ at: new Date(), action: null });
  const markAttempt = (action: string | null) => {
    attemptRef.current = { at: new Date(), action };
  };

  const idleRef = useRef<number | null>(null);

  const resetToPin = useCallback(() => {
    setScreen(authMode === 'pin' ? 'pin' : 'scan');
    setPin('');
    setError(null);
    setSession(null);
    setConfirmMessage(null);
    setConfirmDetail(null);
    setOfflineInfo(null);
    setScanFlash(false);
    setUnpairOpen(false);
    scanInFlight.current = false;
  }, [authMode]);

  // The server couldn't be reached: say so plainly (never "Verification
  // failed" / "Punch failed"), then return to idle like a confirmation.
  const goOffline = useCallback(() => {
    setPin('');
    setError(null);
    setSession(null);
    scanInFlight.current = false;
    setOfflineInfo(attemptRef.current);
    setScreen('offline');
  }, []);

  // If the admin flips mode while the tablet is live on the home screen,
  // bounce back to the right entry screen.
  useEffect(() => {
    if (screen === 'pin' || screen === 'scan') {
      setScreen(authMode === 'pin' ? 'pin' : 'scan');
    }
  }, [authMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inactivity auto-lock: any user input resets the timer. Falling back to
  // the PIN screen after KIOSK_IDLE_LOCK_SECONDS prevents a walk-away from
  // a lingering punchable session.
  const bump = useCallback(() => {
    if (idleRef.current) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => resetToPin(), KIOSK_IDLE_LOCK_SECONDS * 1000);
  }, [resetToPin]);

  useEffect(() => {
    bump();
    const handler = () => bump();
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      if (idleRef.current) window.clearTimeout(idleRef.current);
    };
  }, [bump]);

  // Clear the scan-success flash after it's done its job visually.
  useEffect(() => {
    if (!scanFlash) return;
    const id = window.setTimeout(() => setScanFlash(false), 600);
    return () => window.clearTimeout(id);
  }, [scanFlash]);

  // Confirmation / offline screens: 10-sec countdown then back to PIN.
  useEffect(() => {
    if (screen !== 'confirmation' && screen !== 'offline') return;
    setConfirmCountdown(CONFIRM_SECONDS);
    const id = window.setInterval(() => {
      setConfirmCountdown((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          resetToPin();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [screen, resetToPin]);

  const verify = useMutation({
    // Run even when the tablet reports offline, so the failure reaches
    // onError and the offline screen (the default would pause silently).
    networkMode: 'always',
    mutationFn: (submittedPin: string) => kioskApi.verifyPin(submittedPin),
    onSuccess: (ctx) => {
      setSession(ctx);
      setPin('');
      setScreen('menu');
    },
    onError: (err) => {
      if (isKioskUnreachable(err)) return goOffline();
      setPin('');
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    },
  });

  const scan = useMutation({
    // Run even when the tablet reports offline, so the failure reaches
    // onError and the offline screen (the default would pause silently).
    networkMode: 'always',
    mutationFn: (payload: string) => kioskApi.scanBadge(payload),
    onSuccess: (ctx) => {
      setSession(ctx);
      setError(null);
      setScanFlash(true);
      // The scanner is paused via scanInFlight until we navigate away.
      setScreen('menu');
    },
    onError: (err) => {
      if (isKioskUnreachable(err)) return goOffline();
      setError(err instanceof ApiError ? err.message : 'Scan failed');
      scanInFlight.current = false;
    },
  });

  // `scan.mutate` is stable across renders; keep the callback identity stable
  // too so BadgeScanner's init effect doesn't churn on every parent render.
  const scanMutateRef = useRef(scan.mutate);
  scanMutateRef.current = scan.mutate;

  const handleDecode = useCallback((payload: string) => {
    if (scanInFlight.current) return;
    if (!payload.startsWith('vpt1.')) {
      // Ignore random QR codes (URLs, vCards, etc.). Don't call the
      // server — that would just burn the per-kiosk scan budget.
      setError('This QR is not a Vibe PT badge.');
      return;
    }
    scanInFlight.current = true;
    attemptRef.current = { at: new Date(), action: null };
    scanMutateRef.current(payload);
  }, []);

  const punch = useMutation({
    // Run even when the tablet reports offline, so the failure reaches
    // onError and the offline screen (the default would pause silently).
    networkMode: 'always',
    mutationFn: async (req: {
      action: PunchAction;
      lunchMinutes?: KioskClockOutRequest['lunchMinutes'];
    }) => {
      if (!session) throw new ApiError(401, 'unauthorized', 'No active session');
      const token = session.sessionToken;
      switch (req.action) {
        case 'clockIn':
          return { label: 'Clocked in', entry: await kioskApi.clockIn(token) };
        case 'clockOut': {
          const entry = await kioskApi.clockOut(token, { lunchMinutes: req.lunchMinutes });
          return {
            label: 'Clocked out',
            entry,
            // Older servers don't send it; then the screen just says "Clocked out".
            detail:
              typeof entry.todayWorkSeconds === 'number'
                ? workedToday(entry.todayWorkSeconds, timeFormat)
                : null,
          };
        }
        case 'breakIn':
          return { label: 'On break', entry: await kioskApi.breakIn(token) };
        case 'breakOut':
          return { label: 'Back from break', entry: await kioskApi.breakOut(token) };
      }
    },
    onSuccess: (res) => {
      setConfirmMessage(res.label);
      setConfirmDetail('detail' in res ? (res.detail ?? null) : null);
      setScreen('confirmation');
    },
    onError: (err) => {
      if (isKioskUnreachable(err)) return goOffline();
      setError(err instanceof ApiError ? err.message : 'Punch failed');
      // Back to the menu so the message shows beside the buttons.
      setScreen('menu');
    },
  });

  if (!kiosk) {
    return null;
  }

  const appendDigit = (d: string) => {
    setError(null);
    if (pin.length >= PIN_LEN_MAX) return;
    const next = pin + d;
    setPin(next);
    if (next.length >= PIN_LEN_MIN) {
      // Don't auto-submit until user explicitly taps "Enter" — lets users
      // punch longer PINs correctly. The UX elsewhere (big Enter button)
      // compensates.
    }
  };

  const submitPin = () => {
    if (pin.length < PIN_LEN_MIN) {
      setError(`PIN must be at least ${PIN_LEN_MIN} digits`);
      return;
    }
    markAttempt(null);
    verify.mutate(pin);
  };

  const unpair = async () => {
    // Revoke the device token server-side so the copy in this tablet's
    // storage is dead, not just forgotten. Offline: unpair locally anyway;
    // an admin can still revoke the device under Settings, Kiosks.
    try {
      await kioskApi.unpair();
    } catch {
      /* best effort */
    }
    kioskStore.set(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-2 text-base">
        <div>
          <span className="font-semibold text-white">{kiosk.companyName}</span>
          <span className="ml-2 text-slate-300">· {kiosk.deviceName}</span>
        </div>
        <KioskButton
          variant="link"
          onClick={() => setUnpairOpen(true)}
          className="min-h-11 text-sm"
        >
          Unpair
        </KioskButton>
      </header>
      {unpairOpen && <UnpairDialog onConfirm={unpair} onCancel={() => setUnpairOpen(false)} />}

      <main className="flex flex-1 items-center justify-center p-6">
        {screen === 'scan' && (
          <div className="flex w-full max-w-md flex-col items-center gap-6">
            <BadgeScanner
              onDecode={handleDecode}
              paused={scan.isPending || scanInFlight.current}
              flashSuccess={scanFlash}
              message={error}
              onUsePin={authMode === 'both' ? () => setScreen('pin') : undefined}
            />
          </div>
        )}
        {screen === 'pin' && (
          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            <PinKeypad
              pin={pin}
              onDigit={appendDigit}
              onBack={() => setPin((p) => p.slice(0, -1))}
              onClear={() => setPin('')}
              onSubmit={submitPin}
              submitting={verify.isPending}
              error={error}
            />
            {authMode === 'both' && (
              <KioskButton
                variant="link"
                onClick={() => {
                  setPin('');
                  setError(null);
                  setScreen('scan');
                }}
              >
                ← Scan badge instead
              </KioskButton>
            )}
          </div>
        )}
        {screen === 'menu' && session && (
          <EmployeeMenu
            ctx={session}
            timeFormat={timeFormat}
            onAction={(action) => {
              setError(null);
              // A long unbroken stretch gets the lunch question first.
              if (action === 'clockOut' && needsLunchPrompt(session, lunchPromptEnabled)) {
                setScreen('lunch');
                return;
              }
              markAttempt(ACTION_LABELS[action]);
              punch.mutate({ action });
            }}
            onCancel={resetToPin}
            pending={punch.isPending}
            error={error}
          />
        )}
        {screen === 'lunch' && session && (
          <LunchPrompt
            ctx={session}
            pending={punch.isPending}
            error={error}
            onChoose={(lunchMinutes) => {
              markAttempt(ACTION_LABELS.clockOut);
              punch.mutate({ action: 'clockOut', lunchMinutes });
            }}
            onBack={() => {
              setError(null);
              setScreen('menu');
            }}
          />
        )}
        {screen === 'confirmation' && confirmMessage && (
          <Confirmation
            message={confirmMessage}
            detail={confirmDetail}
            seconds={confirmCountdown}
            onDismiss={resetToPin}
          />
        )}
        {screen === 'offline' && offlineInfo && (
          <OfflineNotice info={offlineInfo} seconds={confirmCountdown} onDismiss={resetToPin} />
        )}
      </main>
    </div>
  );
}

function PinKeypad({
  pin,
  onDigit,
  onBack,
  onClear,
  onSubmit,
  submitting,
  error,
}: {
  pin: string;
  onDigit: (d: string) => void;
  onBack: () => void;
  onClear: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const masked = '•'.repeat(pin.length).padEnd(PIN_LEN_MAX, '○');
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      <p className="text-lg font-medium uppercase tracking-widest text-slate-200">Enter your PIN</p>
      <div className="font-mono text-5xl tracking-[0.4em] text-white">{masked}</div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400 bg-red-950 px-4 py-3 text-base font-medium text-red-100"
        >
          {error}
        </p>
      )}
      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <KeyButton key={d} onClick={() => onDigit(d)} disabled={submitting}>
            {d}
          </KeyButton>
        ))}
        <KeyButton onClick={onClear} disabled={submitting} variant="muted">
          Clear
        </KeyButton>
        <KeyButton onClick={() => onDigit('0')} disabled={submitting}>
          0
        </KeyButton>
        <KeyButton onClick={onBack} disabled={submitting} variant="muted">
          <span aria-label="Backspace">⌫</span>
        </KeyButton>
      </div>
      <KioskButton className="w-full" onClick={onSubmit} loading={submitting}>
        Enter
      </KioskButton>
    </div>
  );
}

function KeyButton({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'muted';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex h-20 items-center justify-center rounded-xl text-3xl font-semibold shadow-md transition select-none ' +
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300 active:scale-95 ' +
        (variant === 'muted'
          ? 'border-2 border-slate-400 bg-slate-700 text-xl text-white hover:bg-slate-600 active:bg-slate-800'
          : 'bg-slate-100 text-slate-900 hover:bg-white active:bg-slate-300') +
        ' disabled:opacity-60'
      }
    >
      {children}
    </button>
  );
}

type PunchAction = 'clockIn' | 'clockOut' | 'breakIn' | 'breakOut';

const ACTION_LABELS: Record<PunchAction, string> = {
  clockIn: 'Clock in',
  clockOut: 'Clock out',
  breakIn: 'Start break',
  breakOut: 'End break',
};

/** True when the open entry is a work stretch long enough to ask about lunch. */
function needsLunchPrompt(ctx: KioskEmployeeContext, enabled: boolean): boolean {
  if (!enabled) return false;
  const open = ctx.openEntry;
  if (open?.entryType !== 'work') return false;
  return (Date.now() - new Date(open.startedAt).getTime()) / 1000 >= KIOSK_LUNCH_PROMPT_SECONDS;
}

const LUNCH_CHOICES: Array<{ minutes: 0 | 30 | 60; label: string }> = [
  { minutes: 30, label: '30 minute lunch' },
  { minutes: 60, label: '60 minute lunch' },
  { minutes: 0, label: 'Worked through lunch' },
];

function LunchPrompt({
  ctx,
  onChoose,
  onBack,
  pending,
  error,
}: {
  ctx: KioskEmployeeContext;
  onChoose: (minutes: 0 | 30 | 60) => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <p className="text-lg font-medium uppercase tracking-widest text-slate-200">Before you go</p>
      <h2 className="text-4xl font-semibold text-white">{ctx.firstName}, did you take lunch?</h2>
      <p className="text-lg text-slate-200">
        You have been on the clock for over 6 hours. Your time will be adjusted and you will be
        clocked out.
      </p>
      <div className="grid w-full gap-3">
        {LUNCH_CHOICES.map((c) => (
          <KioskButton
            key={c.minutes}
            variant={c.minutes === 0 ? 'secondary' : 'primary'}
            loading={pending}
            onClick={() => onChoose(c.minutes)}
          >
            {c.label}
          </KioskButton>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400 bg-red-950 px-4 py-3 text-base font-medium text-red-100"
        >
          {error}
        </p>
      )}
      <KioskButton variant="link" onClick={onBack} disabled={pending}>
        ← Back
      </KioskButton>
    </div>
  );
}

function EmployeeMenu({
  ctx,
  timeFormat,
  onAction,
  onCancel,
  pending,
  error,
}: {
  ctx: KioskEmployeeContext;
  timeFormat: TimeFormat;
  onAction: (action: PunchAction) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const isClockedIn = ctx.openEntry?.entryType === 'work';
  const isOnBreak = ctx.openEntry?.entryType === 'break';
  const isClockedOut = !ctx.openEntry;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <p className="text-lg font-medium uppercase tracking-widest text-slate-200">Welcome</p>
      <h2 className="text-4xl font-semibold text-white">
        {ctx.firstName} {ctx.lastName}
      </h2>
      <p className="text-lg text-slate-200">{workedToday(ctx.todayWorkSeconds, timeFormat)}</p>

      <div className="grid w-full gap-3">
        {isClockedOut && (
          <KioskButton loading={pending} onClick={() => onAction('clockIn')}>
            Clock in
          </KioskButton>
        )}
        {isClockedIn && (
          <>
            <KioskButton variant="danger" loading={pending} onClick={() => onAction('clockOut')}>
              Clock out
            </KioskButton>
            <KioskButton variant="secondary" loading={pending} onClick={() => onAction('breakIn')}>
              Start break
            </KioskButton>
          </>
        )}
        {isOnBreak && (
          <KioskButton loading={pending} onClick={() => onAction('breakOut')}>
            End break
          </KioskButton>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400 bg-red-950 px-4 py-3 text-base font-medium text-red-100"
        >
          {error}
        </p>
      )}

      <KioskButton variant="link" onClick={onCancel} className="mt-2">
        Not me — cancel
      </KioskButton>
    </div>
  );
}

function Confirmation({
  message,
  detail,
  seconds,
  onDismiss,
}: {
  message: string;
  detail: string | null;
  seconds: number;
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex h-28 w-28 items-center justify-center rounded-full bg-emerald-500 text-6xl font-bold text-slate-950">
        ✓
      </div>
      <h2 className="text-4xl font-semibold text-white">{message}</h2>
      {detail && <p className="text-2xl font-medium text-slate-100">{detail}</p>}
      <p className="text-base text-slate-200">Returning to the start screen in {seconds}s</p>
      <KioskButton variant="secondary" onClick={onDismiss} className="min-w-40">
        Done
      </KioskButton>
    </div>
  );
}

function OfflineNotice({
  info,
  seconds,
  onDismiss,
}: {
  info: { at: Date; action: string | null };
  seconds: number;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
      <div className="flex h-28 w-28 items-center justify-center rounded-full bg-amber-400 text-6xl font-bold text-slate-950">
        !
      </div>
      <h2 className="text-4xl font-semibold text-white">Kiosk offline</h2>
      <p className="text-2xl text-slate-100">Clock in on your phone or tell your supervisor.</p>
      <p className="text-xl font-medium text-amber-200">
        {info.action ? `${info.action} attempted` : 'Attempted'} at {clockTime(info.at)}
      </p>
      <p className="text-base text-slate-200">
        {/* A punch that timed out may still have reached the server. */}
        {info.action ? 'It may not have been recorded.' : 'Nothing was recorded.'} Returning to the
        start screen in {seconds}s
      </p>
      <KioskButton variant="secondary" onClick={onDismiss} className="min-w-40">
        Done
      </KioskButton>
    </div>
  );
}

/** Typing the word keeps a passer-by from unpairing the tablet with one tap. */
function UnpairDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === UNPAIR_WORD;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unpair-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
    >
      <form
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-slate-800 p-6 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok || busy) return;
          setBusy(true);
          void onConfirm().finally(() => setBusy(false));
        }}
      >
        <h2 id="unpair-title" className="text-2xl font-semibold text-white">
          Unpair this tablet?
        </h2>
        <p className="text-base text-slate-200">
          The tablet stops working as a kiosk until an admin issues a new pairing code. Type{' '}
          <span className="font-mono font-semibold text-white">{UNPAIR_WORD}</span> to confirm.
        </p>
        <input
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={`Type ${UNPAIR_WORD} to confirm`}
          className="rounded-md border border-slate-500 bg-slate-900 px-3 py-3 text-xl text-white"
        />
        <div className="flex gap-3">
          <KioskButton type="button" variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </KioskButton>
          <KioskButton
            type="submit"
            variant="danger"
            disabled={!ok}
            loading={busy}
            className="flex-1"
          >
            Unpair
          </KioskButton>
        </div>
      </form>
    </div>
  );
}
