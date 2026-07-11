import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { cloneElement, useId, useState } from 'react';

type TriggerProps = {
  onMouseEnter?: (event: MouseEvent) => void;
  onMouseLeave?: (event: MouseEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  'aria-describedby'?: string | undefined;
};

export interface TooltipProps {
  content: string;
  children: ReactElement<TriggerProps>;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (event: MouseEvent) => {
      children.props.onMouseEnter?.(event);
      setOpen(true);
    },
    onMouseLeave: (event: MouseEvent) => {
      children.props.onMouseLeave?.(event);
      setOpen(false);
    },
    onFocus: (event: FocusEvent) => {
      children.props.onFocus?.(event);
      setOpen(true);
    },
    onBlur: (event: FocusEvent) => {
      children.props.onBlur?.(event);
      setOpen(false);
    },
    onKeyDown: (event: KeyboardEvent) => {
      children.props.onKeyDown?.(event);
      if (event.key === 'Escape') setOpen(false);
    },
  });

  return (
    <span className="tooltip-wrapper">
      {trigger}
      {open && (
        <span role="tooltip" id={id} className="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
