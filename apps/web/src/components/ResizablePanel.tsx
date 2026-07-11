import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { IconButton } from './ui/IconButton.js';

export interface ResizablePanelProps {
  side: 'left' | 'right';
  /** Used to build the toggle/resizer accessible names ("Collapse Feature Tree", "Resize Feature Tree"). */
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  children: ReactNode;
}

const KEYBOARD_STEP = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const TOGGLE_ICONS = {
  left: { expanded: PanelLeftClose, collapsed: PanelLeftOpen },
  right: { expanded: PanelRightClose, collapsed: PanelRightOpen },
} as const;

/** Collapsible, resizable side panel with a keyboard-accessible splitter, used for the left feature tree and right context panel. */
export function ResizablePanel({ side, label, defaultWidth, minWidth, maxWidth, children }: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [collapsed, setCollapsed] = useState(false);
  const dragStart = useRef({ x: 0, width: 0 });

  function resizeBy(rawDelta: number): void {
    const signedDelta = side === 'left' ? rawDelta : -rawDelta;
    setWidth((current) => clamp(current + signedDelta, minWidth, maxWidth));
  }

  function handleResizerMouseDown(event: MouseEvent<HTMLDivElement>): void {
    dragStart.current = { x: event.clientX, width };

    function handleMouseMove(moveEvent: globalThis.MouseEvent): void {
      const delta = moveEvent.clientX - dragStart.current.x;
      const signedDelta = side === 'left' ? delta : -delta;
      setWidth(clamp(dragStart.current.width + signedDelta, minWidth, maxWidth));
    }
    function handleMouseUp(): void {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleResizerKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        resizeBy(side === 'left' ? -KEYBOARD_STEP : KEYBOARD_STEP);
        break;
      case 'ArrowRight':
        event.preventDefault();
        resizeBy(side === 'left' ? KEYBOARD_STEP : -KEYBOARD_STEP);
        break;
      case 'Home':
        event.preventDefault();
        setWidth(minWidth);
        break;
      case 'End':
        event.preventDefault();
        setWidth(maxWidth);
        break;
      default:
        break;
    }
  }

  const ToggleIcon = collapsed ? TOGGLE_ICONS[side].collapsed : TOGGLE_ICONS[side].expanded;
  const toggleLabel = collapsed ? `Expand ${label}` : `Collapse ${label}`;

  return (
    <div
      className={cn('resizable-panel', `resizable-panel--${side}`, collapsed && 'resizable-panel--collapsed')}
      style={{ width: collapsed ? undefined : `${width}px` }}
    >
      {side === 'right' && !collapsed && (
        <div
          className="resizable-panel__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={Math.round(width)}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          onMouseDown={handleResizerMouseDown}
          onKeyDown={handleResizerKeyDown}
        />
      )}

      <div className="resizable-panel__header">
        <IconButton
          className="resizable-panel__toggle"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          icon={<ToggleIcon />}
          onClick={() => setCollapsed((value) => !value)}
        />
      </div>

      {!collapsed && <div className="resizable-panel__body">{children}</div>}

      {side === 'left' && !collapsed && (
        <div
          className="resizable-panel__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={Math.round(width)}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          onMouseDown={handleResizerMouseDown}
          onKeyDown={handleResizerKeyDown}
        />
      )}
    </div>
  );
}
