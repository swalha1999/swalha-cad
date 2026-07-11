import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import type { ButtonVariant } from './Button.js';
import { Button } from './Button.js';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: ReactNode;
  /** Required: an icon-only button has no visible text, so it needs an explicit accessible name. */
  'aria-label': string;
  variant?: ButtonVariant;
}

export function IconButton({ icon, variant = 'ghost', className, ...props }: IconButtonProps) {
  return (
    <Button variant={variant} size="icon" className={cn('icon-btn', className)} {...props}>
      {icon}
    </Button>
  );
}
