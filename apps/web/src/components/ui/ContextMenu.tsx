import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export interface ContextMenuProps {
  /** Accessible name for the menu (e.g. the row it acts on). */
  label: string;
  /** Viewport coordinates the menu opens at. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A small right-click context menu positioned at the cursor. Renders a
 * `role="menu"` with `role="menuitem"` buttons, focuses the first item on open,
 * closes on Escape, outside pointer-down, or after an item is chosen, and
 * supports Up/Down/Home/End roving focus — matching the keyboard semantics of
 * the existing dropdown menu.
 */
export function ContextMenu({ label, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onClose]);

  function focusItem(index: number): void {
    const count = items.length;
    if (count === 0) return;
    itemRefs.current[((index % count) + count) % count]?.focus();
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  }

  function select(item: ContextMenuItem): void {
    item.onSelect();
    onClose();
  }

  return (
    <ul
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', top: y, left: x }}
    >
      {items.map((item, index) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className={item.destructive ? 'context-menu__item context-menu__item--destructive' : 'context-menu__item'}
            onClick={() => select(item)}
            onKeyDown={(event) => handleItemKeyDown(event, index)}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
