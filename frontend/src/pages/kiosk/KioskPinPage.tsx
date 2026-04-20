import { useMutation } from '@tanstack/react-query';
import type { KioskEmployeeContext } from '@vibept/shared';
import { KIOSK_IDLE_LOCK_SECONDS } from '@vibept/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { useKiosk } from '../../hooks/useKiosk';
import { ApiError } from '../../lib/api';
import { kioskApi } from '../../lib/kiosk-api';
import { kioskStore } from '../../lib/kiosk-store';

type Screen = 'pin' | 'menu' | 'confirmation';

const PIN_LEN_MIN = 4;
const PIN_LEN_MAX = 6;
const CONFIRM_SECONDS = 10;

export function KioskPinPage() {
  const kiosk = useKiosk();

  const [screen, setScreen] = useState<Screen>('pin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<KioskEmployeeContext | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmCountdown, setConfirmCountdown] = useState(CONFIRM_SECONDS);

  const idleRef = useRef<number | null>(null);

  const resetToPin = useCallback(() => {
    setScreen('pin');
    setPin('');
    setError(null);
    setSession(null);
    setConfirmMessage(null);
  }, []);

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

  // Placeholder punch action. Phase 5 wires the actual POST /punch/*
  // endpoints through kioskApi + the employee session token.
  const stubPunch = useCallback((label: string) => {
    setConfirmMessage(label);
    setScreen('confirmation');
  }, []);

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
        <button
          type="button"
          onClick={clearKiosk}
          className="text-slate-500 hover:text-slate-300"
        >
          Unpair
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        {screen === 'pin' && (
          <PinKeypad
            pin={pin}
            onDigit={appendDigit}
            onBack={() => setPin((p) => p.slice(0, -1))}
            onClear={() => setPin('')}
            onSubmit={submitPin}
            submitting={verify.isPending}
            error={error}
          />
        )}
        {screen === 'menu' && session && (
          <EmployeeMenu
            ctx={session}
            onAction={(label) => stubPunch(label)}
            onCancel={resetToPin}
          />
        )}
        {screen === 'confirmation' && confirmMessage && (
          <Confirmation message={confirmMessage} seconds={confirmCountdown} onDismiss={resetToPin} />
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
      <Button
        type="button"
        className="w-full py-4 text-lg"
        onClick={onSubmit}
        loading={submitting}
      >
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

function EmployeeMenu({
  ctx,
  onAction,
  onCancel,
}: {
  ctx: KioskEmployeeContext;
  onAction: (label: string) => void;
  onCancel: () => void;
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
          <Button className="py-5 text-lg" onClick={() => onAction('Clocked in')}>
            Clock in
          </Button>
        )}
        {isClockedIn && (
          <>
            <Button className="py-5 text-lg" onClick={() => onAction('Clocked out')}>
              Clock out
            </Button>
            <Button
              variant="secondary"
              className="py-4 text-base"
              onClick={() => onAction('Started break')}
            >
              Start break
            </Button>
            <Button
              variant="secondary"
              className="py-4 text-base"
              onClick={() => onAction('Switched job')}
            >
              Switch job
            </Button>
          </>
        )}
        {isOnBreak && (
          <Button className="py-5 text-lg" onClick={() => onAction('Back from break')}>
            End break
          </Button>
        )}
      </div>

      <p className="text-xs text-slate-500">
        (Punch actions will be wired up in Phase 5 of the build plan.)
      </p>

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
      <p className="text-sm text-slate-400">
        Returning to the PIN screen in {seconds}s
      </p>
      <Button variant="secondary" onClick={onDismiss}>
        Done
      </Button>
    </div>
  );
}
