import { type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 focus:ring-slate-700',
  secondary:
    'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 disabled:opacity-60 focus:ring-slate-300',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus:ring-slate-300',
};

export function Button({
  variant = 'primary',
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={
        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm ' +
        'transition focus:outline-none focus:ring-2 focus:ring-offset-1 ' +
        variants[variant] +
        ' ' +
        (className ?? '')
      }
    >
      {loading ? '…' : children}
    </button>
  );
}
