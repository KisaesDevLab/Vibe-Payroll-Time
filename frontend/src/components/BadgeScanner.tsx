import { BrowserQRCodeReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

type CameraState = 'initializing' | 'ready' | 'no_camera' | 'denied' | 'error';

export interface BadgeScannerProps {
  /** Called once per successful decode. The caller should throttle / dedupe. */
  onDecode: (payload: string) => void;
  /** External pause toggle — used while a scan result is being processed
   *  so we don't fire the same payload twice while the backend call is
   *  in flight. */
  paused?: boolean;
  /** Render a small "Use PIN" fallback link; tapped in the parent to flip
   *  to the keypad. Ignored in `qr`-only mode by the parent. */
  onUsePin?: () => void;
  /** Non-fatal status line shown under the viewfinder (e.g. "Badge not
   *  recognized"). Errors that are recoverable by re-presenting the QR. */
  message?: string | null;
  /** If true, flash the viewfinder green to signal a successful read. */
  flashSuccess?: boolean;
}

/**
 * Minimal camera-based QR scanner. Uses @zxing/browser which internally
 * grabs frames from a <video> element. We keep the scan rate low enough
 * for a cheap tablet by letting zxing drive frame acquisition (it runs
 * its own decode loop) but we pause it whenever `paused` flips on.
 *
 * This intentionally skips the Web Worker optimization mentioned in the
 * addendum: worth doing if CPU becomes a problem on older tablets, but
 * correctness ships fine without it.
 */
export function BadgeScanner({
  onDecode,
  paused,
  onUsePin,
  message,
  flashSuccess,
}: BadgeScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [state, setState] = useState<CameraState>('initializing');
  const [errorText, setErrorText] = useState<string | null>(null);

  const startScanner = useCallback(async () => {
    if (controlsRef.current) return;
    if (!videoRef.current) return;

    setState('initializing');
    setErrorText(null);

    try {
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 1000,
      });
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, err) => {
          if (result) {
            onDecode(result.getText());
          }
          // NotFoundException is the normal "nothing in frame yet" path;
          // ignore it, let zxing keep polling.
          if (err && err.name && err.name !== 'NotFoundException') {
            // Non-fatal decode errors — keep scanning.
          }
        },
      );
      controlsRef.current = controls;
      setState('ready');
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      const msg = (err as { message?: string }).message ?? 'Unable to start the camera.';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState('denied');
        setErrorText('Camera access is blocked in the browser. Grant permission and retry.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setState('no_camera');
        setErrorText('No camera detected on this device.');
      } else {
        setState('error');
        setErrorText(msg);
      }
    }
  }, [onDecode]);

  const stopScanner = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // zxing occasionally throws on stop() if the underlying track already
      // ended; safe to ignore.
    }
    controlsRef.current = null;
  }, []);

  useEffect(() => {
    void startScanner();
    return stopScanner;
  }, [startScanner, stopScanner]);

  useEffect(() => {
    if (paused) {
      stopScanner();
    } else if (!controlsRef.current && state === 'ready') {
      void startScanner();
    }
    // We intentionally restart only when coming OUT of paused; the
    // initial mount handles the first start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <p className="text-sm uppercase tracking-widest text-slate-400">
        Hold your badge up to the camera
      </p>

      <div
        className={
          'relative aspect-square w-full overflow-hidden rounded-xl border-2 transition-colors ' +
          (flashSuccess
            ? 'border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.6)]'
            : 'border-slate-700')
        }
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 p-6 text-center text-sm text-slate-200">
            {state === 'initializing' && 'Starting camera…'}
            {state === 'denied' && (
              <div>
                <p className="font-semibold text-white">Camera blocked</p>
                <p className="mt-2 text-slate-300">{errorText}</p>
              </div>
            )}
            {state === 'no_camera' && (
              <div>
                <p className="font-semibold text-white">No camera found</p>
                <p className="mt-2 text-slate-300">Use your PIN instead.</p>
              </div>
            )}
            {state === 'error' && (
              <div>
                <p className="font-semibold text-white">Camera error</p>
                <p className="mt-2 text-slate-300">{errorText}</p>
              </div>
            )}
          </div>
        )}
        {state === 'ready' && <ViewfinderOverlay />}
      </div>

      {message && (
        <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          {message}
        </p>
      )}

      {onUsePin && (
        <button
          type="button"
          onClick={onUsePin}
          className="mt-1 text-sm text-slate-400 hover:text-slate-200"
        >
          Can't scan? Use PIN →
        </button>
      )}
    </div>
  );
}

function ViewfinderOverlay(): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Corner brackets — emphasize the target area without obstructing it. */}
      <div className="absolute left-[12%] top-[12%] h-10 w-10 border-l-2 border-t-2 border-amber-300" />
      <div className="absolute right-[12%] top-[12%] h-10 w-10 border-r-2 border-t-2 border-amber-300" />
      <div className="absolute bottom-[12%] left-[12%] h-10 w-10 border-b-2 border-l-2 border-amber-300" />
      <div className="absolute bottom-[12%] right-[12%] h-10 w-10 border-b-2 border-r-2 border-amber-300" />
      {/* Scanline — tiny brass accent for feel; purely decorative. */}
      <div className="badge-scanline absolute left-[12%] right-[12%] h-[2px] bg-amber-400/60" />
      <style>{`
        .badge-scanline {
          animation: badge-scan 2.4s ease-in-out infinite;
        }
        @keyframes badge-scan {
          0%   { top: 15%; opacity: 0.2; }
          50%  { top: 80%; opacity: 0.8; }
          100% { top: 15%; opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}
