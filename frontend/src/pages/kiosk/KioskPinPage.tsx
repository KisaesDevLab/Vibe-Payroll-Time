// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery } from '@tanstack/react-query';
import type { KioskEmployeeContext } from '@vibept/shared';
import { KIOSK_IDLE_LOCK_SECONDS } from '@vibept/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeScanner } from '../../components/BadgeScanner';
import { Button } from '../../components/Button';
import { useKiosk } from '../../hooks/useKiosk';
import { ApiError } from '../../lib/api';
import { kioskApi } from '../../lib/kiosk-api';
import { kioskStore } from '../../lib/kiosk-store';

type AuthMode = 'pin' | 'qr' | 'both';
type Screen = 'pin' | 'scan' | 'menu' | 'confirmation';

const PIN_LEN_MIN = 4;
const PIN_LEN_MAX = 6;
const CONFIRM_SECONDS = 10;

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

  // Persist the live auth mode back to the store so a refresh picks it up
  // immediately next session.
  useEffect(() => {
    if (!kiosk || !meQuery.data) return;
    if (kiosk.kioskAuthMode === meQuery.data.kioskAuthMode) return;
    kioskStore.set({ ...kiosk, kioskAuthMode: meQuery.data.kioskAuthMode });
  }, [kiosk, meQuery.data]);

  const defaultScreen: Screen = authMode === 'pin' ? 'pin' : 'scan';

  const [screen, setScreen] = useState<Screen>(defaultScreen);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<KioskEmployeeContext | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmCountdown, setConfirmCountdown] = useState(CONFIRM_SECONDS);
  const [scanFlash, setScanFlash] = useState(false);
  const scanInFlight = useRef(false);

  const idleRef = useRef<number | null>(null);

  const resetToPin = useCallback(() => {
    setScreen(authMode === 'pin' ? 'pin' : 'scan');
    setPin('');
    setError(null);
    setSession(null);
    setConfirmMessage(null);
    setScanFlash(false);
    scanInFlight.current = false;
  }, [authMode]);

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

  // Confirmation screen 10-sec countdown then back to PIN.
  useEffect(() => {
    if (screen !== 'confirmation') return;
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
    mutationFn: (submittedPin: string) => kioskApi.verifyPin(submittedPin),
    onSuccess: (ctx) => {
      setSession(ctx);
      setPin('');
      setScreen('menu');
    },
    onError: (err) => {
      setPin('');
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    },
  });

  const scan = useMutation({
    mutationFn: (payload: string) => kioskApi.scanBadge(payload),
    onSuccess: (ctx) => {
      setSession(ctx);
      setError(null);
      setScanFlash(true);
      // The scanner is paused via scanInFlight until we navigate away.
      setScreen('menu');
    },
    onError: (err) => {
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
    scanMutateRef.current(payload);
  }, []);

  const punch = useMutation({
    mutationFn: async (action: 'clockIn' | 'clockOut' | 'breakIn' | 'breakOut') => {
      if (!session) throw new ApiError(401, 'unauthorized', 'No active session');
      const token = session.sessionToken;
      switch (action) {
        case 'clockIn':
          return { label: 'Clocked in', entry: await kioskApi.clockIn(token) };
        case 'clockOut':
          return { label: 'Clocked out', entry: await kioskApi.clockOut(token) };
        case 'breakIn':
          return { label: 'On break', entry: await kioskApi.breakIn(token) };
        case 'breakOut':
          return { label: 'Back from break', entry: await kioskApi.breakOut(token) };
      }
    },
    onSuccess: (res) => {
      setConfirmMessage(res.label);
      setScreen('confirmation');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Punch failed');
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
    verify.mutate(pin);
  };

  const clearKiosk = () => {
    if (confirm('Unpair this tablet? An admin will need to re-issue a pairing code.')) {
      kioskStore.set(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3 text-xs">
        <div>
          <span className="font-semibold text-slate-200">{kiosk.companyName}</span>
          <span className="ml-2 text-slate-500">· {kiosk.deviceName}</span>
        </div>
        <button type="button" onClick={clearKiosk} className="text-slate-500 hover:text-slate-300">
          Unpair
        </button>
      </header>

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
              <button
                type="button"
                onClick={() => {
                  setPin('');
                  setError(null);
                  setScreen('scan');
                }}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                ← Scan badge instead
              </button>
            )}
          </div>
        )}
        {screen === 'menu' && session && (
          <EmployeeMenu
            ctx={session}
            onAction={(action) => punch.mutate(action)}
            onCancel={resetToPin}
            pending={punch.isPending}
            error={error}
          />
        )}
        {screen === 'confirmation' && confirmMessage && (
          <Confirmation
            message={confirmMessage}
            seconds={confirmCountdown}
            onDismiss={resetToPin}
          />
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
      <p className="text-sm uppercase tracking-widest text-slate-400">Enter your PIN</p>
      <div className="font-mono text-4xl tracking-[0.5em] text-white">{masked}</div>
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
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
          ←
        </KeyButton>
      </div>
      <Button type="button" className="w-full py-4 text-lg" onClick={onSubmit} loading={submitting}>
        Enter
      </Button>
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
        'flex h-20 items-center justify-center rounded-lg text-2xl font-medium shadow-sm transition ' +
        (variant === 'muted'
          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
          : 'bg-slate-100 text-slate-900 hover:bg-white') +
        ' disabled:opacity-60'
      }
    >
      {children}
    </button>
  );
}

type PunchAction = 'clockIn' | 'clockOut' | 'breakIn' | 'breakOut';

function EmployeeMenu({
  ctx,
  onAction,
  onCancel,
  pending,
  error,
}: {
  ctx: KioskEmployeeContext;
  onAction: (action: PunchAction) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const isClockedIn = ctx.openEntry?.entryType === 'work';
  const isOnBreak = ctx.openEntry?.entryType === 'break';
  const isClockedOut = !ctx.openEntry;

  const hours = (ctx.todayWorkSeconds / 3600).toFixed(2);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-widest text-slate-400">Welcome</p>
      <h2 className="text-3xl font-semibold text-white">
        {ctx.firstName} {ctx.lastName}
      </h2>
      <p className="text-sm text-slate-400">Today: {hours} hrs worked</p>

      <div className="grid w-full gap-3">
        {isClockedOut && (
          <Button className="py-5 text-lg" loading={pending} onClick={() => onAction('clockIn')}>
            Clock in
          </Button>
        )}
        {isClockedIn && (
          <>
            <Button className="py-5 text-lg" loading={pending} onClick={() => onAction('clockOut')}>
              Clock out
            </Button>
            <Button
              variant="secondary"
              className="py-4 text-base"
              loading={pending}
              onClick={() => onAction('breakIn')}
            >
              Start break
            </Button>
          </>
        )}
        {isOnBreak && (
          <Button className="py-5 text-lg" loading={pending} onClick={() => onAction('breakOut')}>
            End break
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="mt-2 text-sm text-slate-400 hover:text-slate-200"
      >
        Not me — cancel
      </button>
    </div>
  );
}

function Confirmation({
  message,
  seconds,
  onDismiss,
}: {
  message: string;
  seconds: number;
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="rounded-full bg-emerald-500/20 p-6 text-6xl">✓</div>
      <h2 className="text-3xl font-semibold text-white">{message}</h2>
      <p className="text-sm text-slate-400">Returning to the PIN screen in {seconds}s</p>
      <Button variant="secondary" onClick={onDismiss}>
        Done
      </Button>
    </div>
  );
}
