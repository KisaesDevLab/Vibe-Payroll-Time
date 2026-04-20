import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormField } from '../../components/FormField';
import { ApiError } from '../../lib/api';
import { kioskApi } from '../../lib/kiosk-api';
import { kioskStore } from '../../lib/kiosk-store';

const DEFAULT_NAME = (() => {
  if (typeof navigator === 'undefined') return 'Kiosk tablet';
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return 'iPad kiosk';
  if (/Android/i.test(ua)) return 'Android kiosk';
  return 'Kiosk tablet';
})();

export function KioskPairPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(DEFAULT_NAME);

  const pair = useMutation({
    mutationFn: () => kioskApi.pair({ code, deviceName }),
    onSuccess: (data) => {
      kioskStore.set({
        deviceToken: data.deviceToken,
        deviceId: data.device.id,
        deviceName: data.device.name,
        companyId: data.device.companyId,
        companyName: data.companyName,
      });
      navigate('/kiosk', { replace: true });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold text-white">Pair this tablet</h1>
        <p className="mt-2 text-sm text-slate-300">
          Ask an admin to generate a pairing code in the company settings → Kiosks, then enter it
          below.
        </p>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code && deviceName) pair.mutate();
          }}
        >
          <FormField
            label="Pairing code"
            hint="8 digits"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            maxLength={16}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
            className="bg-white text-slate-900"
          />
          <FormField
            label="Device name"
            hint="Shown in the admin UI so admins can identify this tablet."
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="bg-white text-slate-900"
          />
          {pair.isError && (
            <div className="rounded-md border border-red-400/60 bg-red-500/10 p-3 text-sm text-red-200">
              {pair.error instanceof ApiError ? pair.error.message : 'Pairing failed.'}
            </div>
          )}
          <Button type="submit" loading={pair.isPending} disabled={!code || !deviceName}>
            Pair tablet
          </Button>
        </form>
      </div>
    </main>
  );
}
