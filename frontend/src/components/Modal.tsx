// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { type ReactNode, useEffect, useId, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  // No offsetParent / visibility filter: jsdom has no layout, and the
  // dialog never hides its own controls with display:none.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Accessible modal dialog.
 *
 *   - role="dialog", aria-modal, labelled by its title.
 *   - Focus moves into the dialog on open (unless a child already took it
 *     with autoFocus), Tab / Shift+Tab stay inside, and focus returns to
 *     whatever had it before on close.
 *   - Escape and the ✕ close it. A click on the backdrop does NOT: these
 *     dialogs are forms, and a stray tap beside one on a phone must not
 *     throw away what was typed. Cancel buttons in the footer are the
 *     deliberate way out.
 *   - The body scrolls inside a dialog capped at 90dvh, so the footer's
 *     buttons stay on screen when a phone keyboard takes half of it.
 *
 * Callers mount it either with an `open` flag or conditionally with
 * `open` hard-wired; both restore focus because that happens on unmount
 * of the open dialog, not on an open→false transition.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Callers pass inline onClose arrows; holding it in a ref keeps the
  // focus effect keyed on `open` alone, so typing in the form (which
  // re-renders the caller) never re-runs it and yanks focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Whatever had focus when the dialog opened, captured during the render
  // that opens it: by the time any effect runs, a child's autoFocus has
  // already moved focus inside the dialog.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;

    if (dialog && !dialog.contains(document.activeElement)) {
      // First field in the body, else the first control (the ✕), else the
      // dialog itself.
      const body = dialog.querySelector<HTMLElement>('[data-modal-body]');
      const target = (body && focusables(body)[0]) ?? focusables(dialog)[0] ?? dialog;
      target.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = focusables(dialogRef.current);
      if (items.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = dialogRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      if (opener && opener.isConnected && !dialog?.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-50 flex max-h-[90dvh] w-full max-w-lg flex-col rounded-lg bg-white shadow-2xl focus:outline-none"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
