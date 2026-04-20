import { useMutation } from '@tanstack/react-query';
import type { NLCorrectionPreview } from '@vibept/shared';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { ai } from '../lib/resources';
import { Button } from './Button';

interface Props {
  companyId: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  onApplied: () => void;
}

/**
 * "Ask assistant" card — the user types a natural-language correction,
 * the backend returns proposed tool calls, the UI renders them as a
 * diff preview, and only on explicit "Apply" do they reach the punch
 * service.
 *
 * Nothing applies without a human confirming. Rate-limited per
 * employee per day; the remaining quota is surfaced after each
 * preview.
 */
export function NLCorrectionWidget({
  companyId,
  employeeId,
  periodStart,
  periodEnd,
  onApplied,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<NLCorrectionPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      ai.previewCorrection(companyId, {
        employeeId,
        prompt,
        periodStart,
        periodEnd,
      }),
    onSuccess: setPreview,
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('no preview');
      return ai.applyCorrection(companyId, {
        employeeId,
        originalPrompt: prompt,
        toolCalls: preview.toolCalls,
      });
    },
    onSuccess: (res) => {
      if (res.applied > 0) onApplied();
      setPreview(null);
      setPrompt('');
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Ask assistant</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Describe a correction. The assistant shows a preview; nothing changes until you apply
            it.
          </p>
        </div>
        {preview && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {preview.remainingQuota} left today
          </span>
        )}
      </header>

      <textarea
        className="h-20 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm shadow-sm"
        placeholder='e.g. "I forgot to clock out Tuesday, I left at 5:30pm"'
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={previewMutation.isPending || applyMutation.isPending}
      />

      <div className="mt-2 flex justify-end gap-2">
        {preview && (
          <Button
            variant="ghost"
            onClick={() => setPreview(null)}
            disabled={applyMutation.isPending}
          >
            Discard preview
          </Button>
        )}
        {!preview && (
          <Button
            disabled={prompt.trim().length < 3}
            loading={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            Preview
          </Button>
        )}
        {preview && preview.toolCalls.length > 0 && (
          <Button loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
            Apply {preview.toolCalls.length} change
            {preview.toolCalls.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {previewMutation.isError && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {previewMutation.error instanceof ApiError
            ? previewMutation.error.message
            : 'Preview failed.'}
        </div>
      )}

      {preview && (
        <div className="mt-4 flex flex-col gap-3">
          {preview.narrative && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {preview.narrative}
            </p>
          )}
          {preview.toolCalls.length === 0 && (
            <p className="text-xs text-slate-500">
              No changes proposed. Rephrase or add more detail and preview again.
            </p>
          )}
          {preview.toolCalls.length > 0 && (
            <ol className="flex flex-col gap-2 text-sm">
              {preview.toolCalls.map((t) => (
                <li key={t.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-900">{t.summary}</p>
                  <pre className="mt-1 overflow-x-auto text-[11px] text-slate-600">
                    {t.name}({JSON.stringify(t.arguments)})
                  </pre>
                </li>
              ))}
            </ol>
          )}
          {applyMutation.data && (
            <div
              className={
                'rounded-md border p-3 text-xs ' +
                (applyMutation.data.errors.length === 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900')
              }
            >
              Applied {applyMutation.data.applied}, skipped {applyMutation.data.skipped}.
              {applyMutation.data.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {applyMutation.data.errors.map((e) => (
                    <li key={e.toolCallId}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {applyMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {applyMutation.error instanceof ApiError
                ? applyMutation.error.message
                : 'Apply failed.'}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
