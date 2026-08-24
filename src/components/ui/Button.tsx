import { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({
  className,
  variant = 'primary',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center px-6 py-3 text-sm font-medium transition-colors',
        variant === 'primary' &&
          'bg-neutral-900 text-white hover:bg-neutral-800',
        variant === 'secondary' &&
          'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
