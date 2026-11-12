// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        // Inline arrow on purpose: a fresh onClose every render must not
        // re-run the focus logic.
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Edit entry"
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        }
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Notes
          <input />
        </label>
      </Modal>
    </>
  );
}

function openIt() {
  const opener = screen.getByRole('button', { name: 'Open' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('Modal', () => {
  it('is a labelled modal dialog', () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'Edit entry' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus to the first field and keeps it there while typing', () => {
    render(<Harness />);
    openIt();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'abc' } });
    expect(name).toHaveFocus();
  });

  it('traps Tab inside the dialog', () => {
    render(<Harness />);
    openIt();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const close = screen.getByRole('button', { name: 'Close' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openIt();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('restores focus when closed from the footer too', () => {
    render(<Harness />);
    const opener = openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('restores focus to the opener even when a child autoFocuses', () => {
    function AutoFocusHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Hours">
            <label>
              First
              <input />
            </label>
            <label>
              Hours
              <input autoFocus />
            </label>
          </Modal>
        </>
      );
    }
    render(<AutoFocusHarness />);
    const opener = openIt();
    // The child's own choice of field wins over "first field".
    expect(screen.getByLabelText('Hours', { selector: 'input' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not close on a backdrop click (typed input survives)', () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    openIt();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'half typed' } });
    const backdrop = container.ownerDocument.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('half typed');
  });
});
