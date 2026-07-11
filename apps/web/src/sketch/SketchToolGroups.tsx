import { Circle, Dot, Minus, MoreHorizontal, Ruler, Square } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/ui/IconButton.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { useCadStore } from '../store/cad-store-context.js';
import type { SketchToolKind } from './tools/types.js';

/** A single icon-first toolbar action. `shortcut` is surfaced in the tooltip and via aria-keyshortcuts. */
export interface ToolbarItem {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function itemTooltip(item: ToolbarItem): string {
  return item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
}

function ToolbarItemButton({ item }: { item: ToolbarItem }) {
  return (
    <Tooltip content={itemTooltip(item)}>
      <IconButton
        aria-label={item.label}
        aria-pressed={item.pressed}
        aria-keyshortcuts={item.shortcut}
        disabled={item.disabled}
        icon={item.icon}
        onClick={item.onSelect}
      />
    </Tooltip>
  );
}

/**
 * A dense, accessible group of icon-first toolbar actions. Primary `items` are
 * shown inline; any `overflow` items collapse behind a keyboard-accessible "More"
 * menu. This is the reusable grouping/overflow infrastructure the sketch toolbar
 * is built from, so future creation/modify tools can slot into new groups without
 * changing the layout contract.
 */
export function ToolbarGroup({ label, items, overflow }: { label: string; items: ToolbarItem[]; overflow?: ToolbarItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasOverflow = (overflow?.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="sketch-tool-group" role="group" aria-label={label} ref={containerRef}>
      {items.map((item) => (
        <ToolbarItemButton key={item.id} item={item} />
      ))}
      {hasOverflow && (
        <div className="sketch-tool-group__overflow">
          <Tooltip content={`More ${label} tools`}>
            <IconButton
              aria-label={`More ${label} tools`}
              aria-haspopup="menu"
              aria-expanded={open}
              icon={<MoreHorizontal />}
              onClick={() => setOpen((value) => !value)}
            />
          </Tooltip>
          {open && (
            <ul className="sketch-tool-group__menu" role="menu" aria-label={`More ${label} tools`}>
              {overflow!.map((item) => (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="sketch-tool-group__menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect();
                      setOpen(false);
                    }}
                  >
                    <span className="sketch-tool-group__menu-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const CREATE_TOOLS: { kind: SketchToolKind; label: string; icon: ComponentType; shortcut: string }[] = [
  { kind: 'point', label: 'Point', icon: Dot, shortcut: 'P' },
  { kind: 'line', label: 'Line', icon: Minus, shortcut: 'L' },
  { kind: 'rectangle', label: 'Rectangle', icon: Square, shortcut: 'R' },
  { kind: 'circle', label: 'Circle', icon: Circle, shortcut: 'C' },
];

/**
 * The sketch creation toolbar group: the existing point / line / rectangle /
 * circle tools plus the construction-geometry toggle, laid out with the shared
 * {@link ToolbarGroup} so shortcuts, tooltips, and overflow are consistent. Modify
 * and additional creation tools are deferred, but slot into this same structure.
 */
export function SketchToolGroups() {
  const session = useCadStore((state) => state.sketch);
  const setSketchTool = useCadStore((state) => state.setSketchTool);
  const setSketchConstruction = useCadStore((state) => state.setSketchConstruction);

  if (!session) return null;

  const createItems: ToolbarItem[] = CREATE_TOOLS.map(({ kind, label, icon: Icon, shortcut }) => ({
    id: kind,
    label,
    icon: <Icon />,
    shortcut,
    pressed: session.tool === kind,
    onSelect: () => setSketchTool(session.tool === kind ? null : kind),
  }));

  createItems.push({
    id: 'construction',
    label: 'Construction',
    icon: <Ruler />,
    pressed: session.construction,
    onSelect: () => setSketchConstruction(!session.construction),
  });

  return <ToolbarGroup label="Create" items={createItems} />;
}
