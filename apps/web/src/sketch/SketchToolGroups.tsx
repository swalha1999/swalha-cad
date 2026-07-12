import {
  ChevronDown,
  Circle,
  CircleDashed,
  Dot,
  Hexagon,
  Minus,
  MoreHorizontal,
  Pill,
  Radius,
  Ruler,
  Spline,
  Square,
  SquareDashed,
  SquareDot,
  Waypoints,
} from 'lucide-react';
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

function itemTooltip(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

function ToolbarItemButton({ item }: { item: ToolbarItem }) {
  return (
    <Tooltip content={itemTooltip(item.label, item.shortcut)}>
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

/** One selectable variant within a tool family (e.g. corner vs. center rectangle). */
interface ToolVariant {
  kind: SketchToolKind;
  label: string;
  icon: ComponentType;
  shortcut?: string;
}

/**
 * A family of related creation tools. Single-variant families render one plain
 * button; multi-variant families render a split button whose primary action
 * repeats the last-used variant and whose caret opens the full variant menu.
 * `label`/`shortcut` name and key the family's primary button.
 */
interface ToolFamily {
  id: string;
  label: string;
  shortcut?: string;
  variants: ToolVariant[];
}

const TOOL_FAMILIES: ToolFamily[] = [
  { id: 'point', label: 'Point', shortcut: 'P', variants: [{ kind: 'point', label: 'Point', icon: Dot, shortcut: 'P' }] },
  { id: 'line', label: 'Line', shortcut: 'L', variants: [{ kind: 'line', label: 'Line', icon: Minus, shortcut: 'L' }] },
  {
    id: 'rectangle',
    label: 'Rectangle',
    shortcut: 'R',
    variants: [
      { kind: 'rectangle', label: 'Corner rectangle', icon: Square, shortcut: 'R' },
      { kind: 'rectangle-center', label: 'Center rectangle', icon: SquareDot },
      { kind: 'rectangle-3point', label: '3-point rectangle', icon: SquareDashed },
    ],
  },
  {
    id: 'circle',
    label: 'Circle',
    shortcut: 'C',
    variants: [
      { kind: 'circle', label: 'Center circle', icon: Circle, shortcut: 'C' },
      { kind: 'circle-3point', label: '3-point circle', icon: CircleDashed },
    ],
  },
  {
    id: 'arc',
    label: 'Arc',
    shortcut: 'A',
    variants: [
      { kind: 'arc-3point', label: '3-point arc', icon: Spline, shortcut: 'A' },
      { kind: 'arc-center', label: 'Center point arc', icon: Radius },
      { kind: 'arc-tangent', label: 'Tangent arc', icon: Waypoints },
    ],
  },
  { id: 'slot', label: 'Slot', shortcut: 'S', variants: [{ kind: 'slot', label: 'Slot', icon: Pill, shortcut: 'S' }] },
];

/** Renders an icon component as a node (lucide icons are components). */
function iconNode(Icon: ComponentType): ReactNode {
  return <Icon />;
}

/**
 * A split button for a multi-variant family: the primary button repeats the
 * family's last-used variant (defaulting to the first); the caret opens an
 * accessible radio menu of every variant, marking the active one. Both paths run
 * through {@link onSelect}, which the parent uses to record the last-used variant.
 */
function SplitToolButton({
  family,
  lastVariant,
  activeTool,
  onSelect,
}: {
  family: ToolFamily;
  lastVariant: SketchToolKind;
  activeTool: SketchToolKind | null;
  onSelect: (kind: SketchToolKind, options: { toggle: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const primary = family.variants.find((variant) => variant.kind === lastVariant) ?? family.variants[0]!;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="sketch-split-button" role="group" aria-label={family.label} ref={containerRef}>
      <Tooltip content={itemTooltip(primary.label, family.shortcut)}>
        <IconButton
          aria-label={family.label}
          aria-pressed={activeTool === primary.kind}
          aria-keyshortcuts={family.shortcut}
          icon={iconNode(primary.icon)}
          onClick={() => onSelect(primary.kind, { toggle: true })}
        />
      </Tooltip>
      <Tooltip content={`${family.label} variants`}>
        <IconButton
          className="sketch-split-button__caret"
          aria-label={`${family.label} variants`}
          aria-haspopup="menu"
          aria-expanded={open}
          icon={<ChevronDown />}
          onClick={() => setOpen((value) => !value)}
        />
      </Tooltip>
      {open && (
        <ul className="sketch-tool-group__menu" role="menu" aria-label={`${family.label} variants`}>
          {family.variants.map((variant) => (
            <li key={variant.kind} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === variant.kind}
                aria-label={variant.label}
                aria-keyshortcuts={variant.shortcut}
                className="sketch-tool-group__menu-item"
                onClick={() => {
                  onSelect(variant.kind, { toggle: false });
                  setOpen(false);
                }}
              >
                <span className="sketch-tool-group__menu-icon" aria-hidden="true">
                  {iconNode(variant.icon)}
                </span>
                <span className="sketch-split-button__menu-label">{variant.label}</span>
                {variant.shortcut ? <span className="sketch-split-button__menu-shortcut">{variant.shortcut}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The sketch creation toolbar: point / line / rectangle / circle / polygon tool
 * families plus the construction-geometry toggle, laid out as dense icon-first
 * controls. Rectangle and circle are split buttons whose primary action repeats
 * the last-used variant; polygon carries an inline side-count control. The
 * construction toggle flips the mode for new geometry, or (with a selection)
 * converts the selected geometry — all through the store so every committing
 * action still flows through the feature-command history.
 */
export function SketchToolGroups() {
  const session = useCadStore((state) => state.sketch);
  const setSketchTool = useCadStore((state) => state.setSketchTool);
  const toggleConstruction = useCadStore((state) => state.toggleConstruction);
  const setSketchPolygonSides = useCadStore((state) => state.setSketchPolygonSides);
  // Remembers the last variant chosen per family so the split button's primary action repeats it.
  const [lastVariant, setLastVariant] = useState<Partial<Record<string, SketchToolKind>>>({});

  if (!session) return null;

  const activeTool = session.tool;

  const selectVariant = (familyId: string, kind: SketchToolKind, options: { toggle: boolean }): void => {
    setLastVariant((current) => ({ ...current, [familyId]: kind }));
    setSketchTool(options.toggle && activeTool === kind ? null : kind);
  };

  return (
    <div className="sketch-tool-group" role="group" aria-label="Create">
      {TOOL_FAMILIES.map((family) => {
        if (family.variants.length === 1) {
          const only = family.variants[0]!;
          return (
            <ToolbarItemButton
              key={family.id}
              item={{
                id: family.id,
                label: family.label,
                icon: iconNode(only.icon),
                ...(family.shortcut ? { shortcut: family.shortcut } : {}),
                pressed: activeTool === only.kind,
                onSelect: () => selectVariant(family.id, only.kind, { toggle: true }),
              }}
            />
          );
        }
        return (
          <SplitToolButton
            key={family.id}
            family={family}
            lastVariant={lastVariant[family.id] ?? family.variants[0]!.kind}
            activeTool={activeTool}
            onSelect={(kind, options) => selectVariant(family.id, kind, options)}
          />
        );
      })}

      <div className="sketch-polygon" role="group" aria-label="Polygon">
        <ToolbarItemButton
          item={{
            id: 'polygon',
            label: 'Polygon',
            icon: iconNode(Hexagon),
            pressed: activeTool === 'polygon',
            onSelect: () => setSketchTool(activeTool === 'polygon' ? null : 'polygon'),
          }}
        />
        <Tooltip content="Number of polygon sides">
          <input
            type="number"
            min={3}
            className="sketch-polygon__sides"
            aria-label="Polygon sides"
            value={session.polygonSides}
            onChange={(event) => setSketchPolygonSides(Number(event.target.value))}
          />
        </Tooltip>
      </div>

      <ToolbarItemButton
        item={{
          id: 'construction',
          label: 'Construction',
          icon: iconNode(Ruler),
          pressed: session.construction,
          onSelect: () => toggleConstruction(),
        }}
      />
    </div>
  );
}
