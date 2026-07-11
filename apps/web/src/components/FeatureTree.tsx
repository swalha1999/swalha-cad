import { Box, Cylinder, Layers, Move3d, PencilRuler, Shapes, Target } from 'lucide-react';
import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import type { CadFeature, DeletionTarget, Primitive } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { ContextMenu } from './ui/ContextMenu.js';

const PRIMITIVE_ICONS: Record<Primitive['kind'], ComponentType<{ className?: string }>> = {
  box: Box,
  cylinder: Cylinder,
  lBracket: Shapes,
};

const FEATURE_ICONS: Record<CadFeature['kind'], ComponentType<{ className?: string }>> = {
  sketch: PencilRuler,
  extrude: Move3d,
};

const ORIGIN_ROWS = ['Origin', 'Front Plane (XZ)', 'Top Plane (XY)', 'Right Plane (YZ)'];

interface MenuState {
  x: number;
  y: number;
  target: DeletionTarget;
  name: string;
}

/**
 * Left-hand feature tree: a placeholder Origin/plane group above the document's
 * sketch/extrude features and its M1 primitive bodies. Every feature and body row
 * is selectable (synchronized with the viewport), highlights on hover, and offers
 * a right-click context menu whose Delete routes through the store's
 * dependency-aware deletion. The `nav` keeps the "Scene tree" accessible name from
 * M1 so existing browser workflows and their e2e coverage keep working unchanged.
 */
export function FeatureTree() {
  const entities = useCadStore((state) => state.document.entities);
  const features = useCadStore((state) => state.document.features);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const selectedFeatureId = useCadStore((state) => state.selectedFeatureId);
  const hoveredId = useCadStore((state) => state.hoveredId);
  const selectEntity = useCadStore((state) => state.selectEntity);
  const selectFeature = useCadStore((state) => state.selectFeature);
  const setHovered = useCadStore((state) => state.setHovered);
  const requestDelete = useCadStore((state) => state.requestDelete);

  const [menu, setMenu] = useState<MenuState | null>(null);

  function openMenu(event: ReactMouseEvent, target: DeletionTarget, name: string, isSelected: boolean): void {
    event.preventDefault();
    // Right-clicking an unselected row selects it as the context target first.
    if (!isSelected) {
      if (target.kind === 'entity') selectEntity(target.id);
      else selectFeature(target.id);
    }
    setMenu({ x: event.clientX, y: event.clientY, target, name });
  }

  function rowClass(base: string, selected: boolean, hovered: boolean): string {
    return `${base}${selected ? ' feature-tree__row--selected' : ''}${hovered ? ' feature-tree__row--hovered' : ''}`;
  }

  return (
    <nav className="feature-tree" aria-label="Scene tree">
      <h2 className="panel-heading">Part Studio 1</h2>

      <h3 className="feature-tree__section-heading">Origin &amp; Planes</h3>
      <ul className="feature-tree__list feature-tree__list--origin">
        {ORIGIN_ROWS.map((label) => (
          <li key={label} className="feature-tree__origin-row">
            {label === 'Origin' ? <Target className="feature-tree__row-icon" /> : <Layers className="feature-tree__row-icon" />}
            <span>{label}</span>
          </li>
        ))}
      </ul>

      {features.length > 0 && (
        <>
          <h3 className="feature-tree__section-heading">Features</h3>
          <ul className="feature-tree__list">
            {features.map((feature) => {
              const Icon = FEATURE_ICONS[feature.kind];
              const selected = feature.id === selectedFeatureId;
              return (
                <li key={feature.id}>
                  <button
                    type="button"
                    className={rowClass('feature-tree__row', selected, feature.id === hoveredId)}
                    aria-current={selected}
                    aria-label={feature.name}
                    onClick={() => selectFeature(feature.id)}
                    onMouseEnter={() => setHovered(feature.id)}
                    onMouseLeave={() => setHovered(null)}
                    onContextMenu={(event) => openMenu(event, { kind: 'feature', id: feature.id }, feature.name, selected)}
                  >
                    <Icon className="feature-tree__row-icon" />
                    <span className="feature-tree__name">{feature.name}</span>
                    <span className="feature-tree__kind">{feature.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3 className="feature-tree__section-heading">Bodies</h3>
      <ul className="feature-tree__list">
        {entities.map((entity) => {
          const Icon = PRIMITIVE_ICONS[entity.primitive.kind];
          const selected = entity.id === selectedEntityId;
          return (
            <li key={entity.id}>
              <button
                type="button"
                className={rowClass('feature-tree__row', selected, entity.id === hoveredId)}
                aria-current={selected}
                aria-label={entity.name}
                onClick={() => selectEntity(entity.id)}
                onMouseEnter={() => setHovered(entity.id)}
                onMouseLeave={() => setHovered(null)}
                onContextMenu={(event) => openMenu(event, { kind: 'entity', id: entity.id }, entity.name, selected)}
              >
                <Icon className="feature-tree__row-icon" />
                <span className="feature-tree__name">{entity.name}</span>
                <span className="feature-tree__kind">{entity.primitive.kind}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {menu && (
        <ContextMenu
          label={menu.name}
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: 'delete',
              label: `Delete ${menu.name}`,
              destructive: true,
              onSelect: () => requestDelete(menu.target),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
