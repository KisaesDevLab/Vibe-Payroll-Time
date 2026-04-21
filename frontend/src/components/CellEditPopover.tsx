import type { ParseError, TimeFormat } from '@vibept/shared';
import { formatHours } from '@vibept/shared';
import { useState } from 'react';
import { Button } from './Button.js';
import { HoursInput } from './HoursInput.js';
import { Modal } from './Modal.js';

export interface CellEditPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Popover mode — drives header + required-reason behavior. */
  mode: 'add' | 'override' | 'edit';
  format: TimeFormat;
  /** Pre-filled values when in edit/override mode. */
  initialSeconds?: number | null;
  initialReason?: string;
  /** Context for the header. */
  dayLabel: string;
  jobLabel: string;
  /** On override only: show what's being replaced. */
  originalPunchText?: string | null;
  /** Handler receives parsed seconds + reason + the raw input (for
   *  audit). Rejected when the input is unparseable. */
  onSave: (input: { seconds: number; reason: string; typedInput: string }) => Promise<void>;
  /** Optional delete affordance for edit mode. */
  onDelete?: (() => Promise<void>) | undefined;
  saving?: boolean;
  errorText?: string | null;
}

export function CellEditPopover({
  open,
  onClose,
  mode,
  format,
  initialSeconds = null,
  initialReason = '',
  dayLabel,
  jobLabel,
  originalPunchText,
  onSave,
  onDelete,
  saving,
  errorText,
}: CellEditPopoverProps): JSX.Element {
  const [seconds, setSeconds] = useState<number | null>(initialSeconds);
  const [parseError, setParseError] = useState<ParseError | null>(null);
  const [reason, setReason] = useState(initialReason);
  const [typedInput, setTypedInput] = useState(
    initialSeconds != null ? formatHours(initialSeconds, format) : '',
  );

  const reasonRequired = mode !== 'add';
  const canSave =
    seconds != null && seconds > 0 && !parseError && (!reasonRequired || reason.trim().length > 0);

  const title =
    mode === 'add' ? 'Add entry' : mode === 'override' ? 'Override punch' : 'Edit entry';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center justify-between gap-2">
          <div>
            {onDelete && (
              <Button
                variant="ghost"
                onClick={() => void onDelete()}
                disabled={saving}
                className="!text-red-600 hover:!bg-red-50"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!canSave || seconds == null) return;
                void onSave({ seconds, reason: reason.trim(), typedInput });
              }}
              disabled={!canSave}
              loading={saving}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{dayLabel}</span>
          <span className="font-medium text-slate-700">{jobLabel}</span>
        </div>

        {mode === 'override' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="mr-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Punch override
            </span>
            {originalPunchText ? (
              <span>
                Original: <span className="font-mono">{originalPunchText}</span>
              </span>
            ) : (
              <span>This replaces the employee's punched time for this day + job.</span>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Hours</span>
          <HoursInput
            seconds={seconds}
            format={format}
            autoFocus
            disabled={saving ?? false}
            onChange={(s, err) => {
              setSeconds(s);
              setParseError(err);
              // Also track what was typed — the audit payload wants the
              // raw keystroke, not a normalized format.
              if (s != null) {
                setTypedInput(formatHours(s, format, { stripTrailingZeros: true }));
              }
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Reason {reasonRequired && <span className="text-red-500">*</span>}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={saving}
            placeholder={reasonRequired ? 'Required for overrides and edits' : 'Optional'}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
          />
        </label>

        {errorText && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorText}
          </div>
        )}
      </div>
    </Modal>
  );
}
