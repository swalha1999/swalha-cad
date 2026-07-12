import { Box, Cylinder, Layers, Move3d, PencilRuler, Shapes, Target } from 'lucide-react';
import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import type { CadFeature, DeletionTarget, Primitive, SketchPlane } from '@swalha-cad/document';
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

/** The Default geometry origin plane rows, in the reference's order (Origin, then Top/Front/Right). */
const PLANE_ROWS: { label: string; plane: SketchPlane }[] = [
  { label: 'Top', plane: 'XY' },
  { label: 'Front', plane: 'XZ' },
  { label: 'Right', plane: 'YZ' },
];

interface MenuState {
  x: number;
  y: number;
  target: DeletionTarget;
  name: string;
  /** The extrude feature id when the row can be edited, else null (offers an Edit action). */
  editableExtrudeId: string | null;
}

/**
 * Left-hand feature tree, laid out like the reference Part Studio: a
 * `Default geometry` group (Origin plus the Top/Front/Right origin planes),
 * the document's sketch/extrude features (including the active `Sketch N` draft
 * row while a support is being chosen), and a `Parts (N)` list of bodies. The
 * plane rows double as sketch supports: clicking one preselects it (or, while
 * the support command is active, populates the collector); double-clicking a
 * plane during the command confirms it. The `nav` keeps the "Scene tree"
 * accessible name so existing browser workflows and their e2e coverage keep
 * working unchanged.
 */
export function FeatureTree() {
  const entities = useCadStore((state) => state.document.entities);
  const features = useCadStore((state) => state.document.features);
  const selectedEntityId = useCadStore((state) => state.selectedEntityId);
  const selectedFeatureId = useCadStore((state) => state.selectedFeatureId);
  const selectedPlane = useCadStore((state) => state.selectedPlane);
  const hoveredId = useCadStore((state) => state.hoveredId);
  const support = useCadStore((state) => state.sketchSupport?.support ?? null);
  const inSupport = useCadStore((state) => state.sketchSupport !== null);
  const draftName = useCadStore((state) => state.sketchSupport?.draftName ?? null);
  const selectEntity = useCadStore((state) => state.selectEntity);
  const selectFeature = useCadStore((state) => state.selectFeature);
  const editExtrude = useCadStore((state) => state.editExtrude);
  const chooseSketchPlane = useCadStore((state) => state.chooseSketchPlane);
  const confirmSketchSupport = useCadStore((state) => state.confirmSketchSupport);
  const setHovered = useCadStore((state) => state.setHovered);
  const requestDelete = useCadStore((state) => state.requestDelete);

  const [menu, setMenu] = useState<MenuState | null>(null);

  // Which plane row reads as chosen: the collected plane while the command is open, else the preselected one.
  const activePlane: SketchPlane | null =
    support?.kind === 'plane' ? support.plane : inSupport ? null : selectedPlane;

  // A "part" is any solid body: a primitive entity or a derived (extruded) solid.
  const partCount = entities.length + features.filter((feature) => feature.kind === 'extrude').length;

  function openMenu(event: ReactMouseEvent, target: DeletionTarget, name: string, isSelected: boolean): void {
    event.preventDefault();
    // Right-clicking an unselected row selects it as the context target first.
    if (!isSelected) {
      if (target.kind === 'entity') selectEntity(target.id);
      else selectFeature(target.id);
    }
    const editableExtrudeId =
      target.kind === 'feature' && features.some((feature) => feature.id === target.id && feature.kind === 'extrude')
        ? target.id
        : null;
    setMenu({ x: event.clientX, y: event.clientY, target, name, editableExtrudeId });
  }

  function rowClass(base: string, selected: boolean, hovered: boolean): string {
    return `${base}${selected ? ' feature-tree__row--selected' : ''}${hovered ? ' feature-tree__row--hovered' : ''}`;
  }

  return (
    <nav className="feature-tree" aria-label="Scene tree">
      <h2 className="panel-heading">Part Studio 1</h2>

      <h3 className="feature-tree__section-heading">Default geometry</h3>
      <ul className="feature-tree__list feature-tree__list--origin">
        <li className="feature-tree__origin-row">
          <Target className="feature-tree__row-icon" />
          <span>Origin</span>
        </li>
        {PLANE_ROWS.map(({ label, plane }) => {
          const selected = activePlane === plane;
          return (
            <li key={plane}>
              <button
                type="button"
                className={rowClass('feature-tree__row feature-tree__plane-row', selected, false)}
                aria-current={selected}
                aria-label={label}
                onClick={() => chooseSketchPlane(plane)}
                onDoubleClick={() => {
                  // Onshape: double-clicking a plane during the command selects and confirms it.
                  if (inSupport) {
                    chooseSketchPlane(plane);
                    confirmSketchSupport();
                  }
                }}
              >
                <Layers className="feature-tree__row-icon" />
                <span className="feature-tree__name">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {(features.length > 0 || inSupport) && (
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
                    onDoubleClick={() => {
                      if (feature.kind === 'extrude') editExtrude(feature.id);
                    }}
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
            {inSupport && draftName ? (
              <li>
                <div
                  className="feature-tree__row feature-tree__row--selected feature-tree__draft-row"
                  aria-current="true"
                  aria-label={`${draftName} (choosing a plane)`}
                >
                  <PencilRuler className="feature-tree__row-icon" />
                  <span className="feature-tree__name">{draftName}</span>
                  <span className="feature-tree__kind">draft</span>
                </div>
              </li>
            ) : null}
          </ul>
        </>
      )}

      <h3 className="feature-tree__section-heading">Parts ({partCount})</h3>
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
            ...(menu.editableExtrudeId
              ? [{ id: 'edit', label: `Edit ${menu.name}`, onSelect: () => editExtrude(menu.editableExtrudeId!) }]
              : []),
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
