import { ArrowRightToLine, ChevronDown, Scissors, Split } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/ui/IconButton.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { useCadStore } from '../store/cad-store-context.js';
import type { ModifyTool } from './modify/index.js';

/** One Modify tool variant (Trim / Split). */
interface ModifyVariant {
  tool: ModifyTool;
  label: string;
  icon: ComponentType;
  shortcut: string;
  hint: string;
}

const MODIFY_VARIANTS: ModifyVariant[] = [
  { tool: 'trim', label: 'Trim', icon: Scissors, shortcut: 'T', hint: 'Remove a curve segment up to its nearest intersections' },
  { tool: 'split', label: 'Split', icon: Split, shortcut: 'K', hint: 'Split a line or arc at a clicked interior point' },
  {
    tool: 'extend',
    label: 'Extend',
    icon: ArrowRightToLine,
    shortcut: 'E',
    hint: 'Extend a line or arc endpoint to the nearest curve ahead of it',
  },
];

function iconNode(Icon: ComponentType): ReactNode {
  return <Icon />;
}

/**
 * The sketch Modify tool group: a split button whose primary action repeats the
 * last-used Modify tool (Trim by default) and whose caret opens an accessible
 * radio menu of every Modify tool, marking the active one. Both paths route
 * through the store's {@link setSketchModifyTool}, so a click on empty canvas
 * commits nothing while a resolved edit flows through the feature-command history.
 * Each control carries an accessible name, tooltip, keyboard shortcut, active
 * (`aria-pressed`) state, and keyboard focus.
 */
export function SketchModifyGroups() {
  const session = useCadStore((state) => state.sketch);
  const setSketchModifyTool = useCadStore((state) => state.setSketchModifyTool);
  const [lastTool, setLastTool] = useState<ModifyTool>('trim');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (!session) return null;

  const activeTool = session.modify?.tool ?? null;
  const primary = MODIFY_VARIANTS.find((variant) => variant.tool === lastTool) ?? MODIFY_VARIANTS[0]!;

  const select = (tool: ModifyTool): void => {
    setLastTool(tool);
    setSketchModifyTool(tool);
  };

  return (
    <div className="sketch-tool-group" role="group" aria-label="Modify">
      <div className="sketch-split-button" role="group" aria-label="Modify" ref={containerRef}>
        <Tooltip content={`${primary.label} (${primary.shortcut}) — ${primary.hint}`}>
          <IconButton
            aria-label={primary.label}
            aria-pressed={activeTool === primary.tool}
            aria-keyshortcuts={primary.shortcut}
            icon={iconNode(primary.icon)}
            onClick={() => select(primary.tool)}
          />
        </Tooltip>
        <Tooltip content="Modify tools">
          <IconButton
            className="sketch-split-button__caret"
            aria-label="Modify tools"
            aria-haspopup="menu"
            aria-expanded={open}
            icon={<ChevronDown />}
            onClick={() => setOpen((value) => !value)}
          />
        </Tooltip>
        {open && (
          <ul className="sketch-tool-group__menu" role="menu" aria-label="Modify tools">
            {MODIFY_VARIANTS.map((variant) => (
              <li key={variant.tool} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeTool === variant.tool}
                  aria-label={variant.label}
                  aria-keyshortcuts={variant.shortcut}
                  className="sketch-tool-group__menu-item"
                  onClick={() => {
                    select(variant.tool);
                    setOpen(false);
                  }}
                >
                  <span className="sketch-tool-group__menu-icon" aria-hidden="true">
                    {iconNode(variant.icon)}
                  </span>
                  <span className="sketch-split-button__menu-label">{variant.label}</span>
                  <span className="sketch-split-button__menu-shortcut">{variant.shortcut}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
