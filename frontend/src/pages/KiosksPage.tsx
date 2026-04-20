import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KioskDevice, KioskPairingCodeResponse } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { kiosks as kiosksApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

export function KiosksPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const [activeCode, setActiveCode] = useState<KioskPairingCodeResponse | null>(null);

  const list = useQuery({
    queryKey: ['kiosks', companyId],
    queryFn: () => kiosksApi.list(companyId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kiosks', companyId] });

  const issueCode = useMutation({
    mutationFn: () => kiosksApi.issueCode(companyId),
    onSuccess: setActiveCode,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      kiosksApi.rename(companyId, id, name),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: (id: number) => kiosksApi.revoke(companyId, id),
    onSuccess: invalidate,
  });

  return (
    <>
      <header className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Paired tablets that employees use to punch in. Revoking a device invalidates its token
          immediately.
        </p>
        <Button loading={issueCode.isPending} onClick={() => issueCode.mutate()}>
          Generate pairing code
        </Button>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Device</th>
              <th className="px-4 py-3 text-left font-medium">Paired</th>
              <th className="px-4 py-3 text-left font-medium">Last seen</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                onRename={(name) => rename.mutate({ id: d.id, name })}
                onRevoke={() => {
                  if (confirm(`Revoke "${d.name}"? Its token will stop working immediately.`)) {
                    revoke.mutate(d.id);
                  }
                }}
              />
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  No tablets paired yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeCode && (
        <Modal
          open
          onClose={() => {
            setActiveCode(null);
            invalidate();
          }}
          title="Pairing code"
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setActiveCode(null)}>Close</Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600">
            On the tablet, open <code className="rounded bg-slate-100 px-1">/kiosk/pair</code> and
            enter this code. It expires at{' '}
            <span className="font-medium">
              {new Date(activeCode.expiresAt).toLocaleTimeString()}
            </span>
            .
          </p>
          <p className="mt-4 text-center font-mono text-5xl tracking-widest text-slate-900">
            {activeCode.code}
          </p>
        </Modal>
      )}

      {issueCode.isError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {issueCode.error instanceof ApiError ? issueCode.error.message : 'Failed to issue code.'}
        </div>
      )}
    </>
  );
}

function DeviceRow({
  device,
  onRename,
  onRevoke,
}: {
  device: KioskDevice;
  onRename: (name: string) => void;
  onRevoke: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const isRevoked = !!device.revokedAt;

  return (
    <tr className={isRevoked ? 'bg-slate-50 text-slate-500' : ''}>
      <td className="px-4 py-3">
        {editing ? (
          <input
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== device.name) onRename(name.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setName(device.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => !isRevoked && setEditing(true)}
            className="font-medium text-slate-900 hover:underline disabled:cursor-default disabled:no-underline disabled:text-slate-500"
            disabled={isRevoked}
          >
            {device.name}
          </button>
        )}
      </td>
      <td className="px-4 py-3">{new Date(device.pairedAt).toLocaleString()}</td>
      <td className="px-4 py-3">
        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}
      </td>
      <td className="px-4 py-3">
        {isRevoked ? (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
            revoked
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            active
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {!isRevoked && (
          <button
            type="button"
            className="text-sm font-medium text-red-700 hover:underline"
            onClick={onRevoke}
          >
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}
