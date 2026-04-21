import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormatToggle } from '../FormatToggle';

describe('<FormatToggle />', () => {
  it('renders the active segment with the right styling', () => {
    render(<FormatToggle value="decimal" onChange={() => undefined} />);
    const decimal = screen.getByRole('button', { name: /decimal/i });
    const hhmm = screen.getByRole('button', { name: /hh:mm/i });
    expect(decimal.className).toMatch(/bg-slate-900/);
    expect(hhmm.className).not.toMatch(/bg-slate-900/);
  });

  it('fires onChange with the other format when clicked', () => {
    const spy = vi.fn();
    render(<FormatToggle value="decimal" onChange={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /hh:mm/i }));
    expect(spy).toHaveBeenCalledWith('hhmm');
  });

  it('does not fire onChange when the active segment is re-clicked', () => {
    const spy = vi.fn();
    render(<FormatToggle value="decimal" onChange={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /decimal/i }));
    expect(spy).not.toHaveBeenCalled();
  });
});
