import { Pencil, Trash2 } from 'lucide-react';
import type { CadEntity, CadEntityPatch, CadFeature, Primitive, SketchConstraint, SketchFeature } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { selectActiveSketch, selectSelectedEntity, selectSelectedFeature } from '../store/cad-store.js';
import { constraintUnit, constraintValue } from '../sketch/constraint-actions.js';
import { ConstraintStatus } from '../sketch/ConstraintStatus.js';
import { DimensionEditor } from '../sketch/DimensionEditor.js';
import { ExtrudeDialog } from '../features/ExtrudeDialog.js';
import { SketchSupportPanel } from '../features/SketchSupportPanel.js';
import { IconButton } from './ui/IconButton.js';
import { NumericField } from './NumericField.js';
import { TransformFields } from './TransformFields.js';

const CONSTRAINT_LABEL: Record<SketchConstraint['kind'], string> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  distance: 'Distance',
  radius: 'Radius',
  angle: 'Angle',
};

/** A one-line human summary of a constraint, including its dimension where applicable. */
function constraintSummary(constraint: SketchConstraint): string {
  const value = constraintValue(constraint);
  if (value === null) return CONSTRAINT_LABEL[constraint.kind];
  const unit = constraintUnit(constraint) === 'deg' ? '°' : ' mm';
  return `${CONSTRAINT_LABEL[constraint.kind]} ${Number.parseFloat(value.toFixed(2))}${unit}`;
}

interface DimensionField {
  label: string;
  value: number;
  unit?: string;
  onCommit: (next: number) => boolean;
}

function dimensionFieldsFor(primitive: Primitive, commitPrimitive: (next: Primitive) => boolean): DimensionField[] {
  switch (primitive.kind) {
    case 'box':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, width: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Depth', value: primitive.depth, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, depth: v }) },
      ];
    case 'cylinder':
      return [
        { label: 'Radius', value: primitive.radius, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, radius: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Segments', value: primitive.segments, onCommit: (v) => commitPrimitive({ ...primitive, segments: Math.round(v) }) },
      ];
    case 'lBracket':
      return [
        { label: 'Width', value: primitive.width, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, width: v }) },
        { label: 'Height', value: primitive.height, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, height: v }) },
        { label: 'Depth', value: primitive.depth, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, depth: v }) },
        { label: 'Thickness', value: primitive.thickness, unit: 'mm', onCommit: (v) => commitPrimitive({ ...primitive, thickness: v }) },
      ];
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unknown primitive kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function ContextPanelContent({
  entity,
  updateEntity,
}: {
  entity: CadEntity;
  updateEntity: (id: string, patch: CadEntityPatch) => boolean;
}) {
  const commitPrimitive = (next: Primitive) => updateEntity(entity.id, { primitive: next });
  const commitTransform = (next: CadEntity['transform']) => updateEntity(entity.id, { transform: next });

  return (
    <div className="context-panel__content">
      <div className="field">
        <label htmlFor="entity-name">Name</label>
        <input id="entity-name" type="text" readOnly value={entity.name} />
      </div>

      <h3 className="context-panel__section">Dimensions</h3>
      {dimensionFieldsFor(entity.primitive, commitPrimitive).map((field) => (
        <NumericField key={field.label} {...field} />
      ))}

      <h3 className="context-panel__section">Transform</h3>
      <TransformFields transform={entity.transform} onCommit={commitTransform} />
    </div>
  );
}

/**
 * Sketch-mode contextual panel: live solver status, the constraint list (each
 * row selectable and deletable), and the numeric dimension editor for the
 * selected dimensional constraint. Every mutation routes through the store's
 * feature-command history, so undo/redo and the blue/dark/red status convention
 * stay consistent with the canvas.
 */
function SketchContextContent({ sketch }: { sketch: SketchFeature }) {
  const selectedConstraintId = useCadStore((state) => state.selectedConstraintId);
  const selectConstraint = useCadStore((state) => state.selectConstraint);
  const deleteConstraint = useCadStore((state) => state.deleteConstraint);

  return (
    <div className="context-panel__content">
      <ConstraintStatus />

      <h3 className="context-panel__section">Constraints</h3>
      {sketch.constraints.length === 0 ? (
        <p className="context-panel__empty">Select geometry and apply a constraint.</p>
      ) : (
        <ul className="constraint-list">
          {sketch.constraints.map((constraint) => (
            <li key={constraint.id} className="constraint-list__row">
              <button
                type="button"
                className="constraint-list__select"
                aria-pressed={selectedConstraintId === constraint.id}
                onClick={() => selectConstraint(selectedConstraintId === constraint.id ? null : constraint.id)}
              >
                {constraintSummary(constraint)}
              </button>
              <IconButton
                aria-label={`Delete ${CONSTRAINT_LABEL[constraint.kind]} constraint`}
                variant="ghost"
                icon={<Trash2 />}
                onClick={() => deleteConstraint(constraint.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <h3 className="context-panel__section">Dimension</h3>
      <DimensionEditor />
    </div>
  );
}

const FEATURE_KIND_LABEL: Record<CadFeature['kind'], string> = {
  sketch: 'Sketch feature',
  extrude: 'Extruded solid',
};

/** Summary for a selected feature (sketch or extrude); an extrude also offers Edit, and both delete via the header trash action. */
function FeatureContextContent({ feature }: { feature: CadFeature }) {
  const editExtrude = useCadStore((state) => state.editExtrude);
  return (
    <div className="context-panel__content">
      <div className="field">
        <label htmlFor="feature-name">Name</label>
        <input id="feature-name" type="text" readOnly value={feature.name} />
      </div>
      <p className="context-panel__hint">{FEATURE_KIND_LABEL[feature.kind]}</p>
      {feature.kind === 'extrude' ? (
        <button
          type="button"
          className="btn btn--sm btn--outline"
          aria-label={`Edit ${feature.name}`}
          onClick={() => editExtrude(feature.id)}
        >
          <Pencil aria-hidden="true" />
          Edit
        </button>
      ) : null}
    </div>
  );
}

/**
 * Right-hand contextual panel: while a sketch is active it shows constraint
 * status/list/dimension editing; otherwise it shows dimension/transform editing
 * for the selected body, a summary for a selected feature, and a contextual
 * trash action to delete the current selection. Keeps M1's "Properties"
 * accessible name and empty-state copy so the existing browser workflows and
 * their e2e coverage keep working.
 */
export function ContextPanel() {
  const entity = useCadStore(selectSelectedEntity);
  const feature = useCadStore(selectSelectedFeature);
  const updateEntity = useCadStore((state) => state.updateEntity);
  const deleteSelected = useCadStore((state) => state.deleteSelected);
  const sketch = useCadStore(selectActiveSketch);
  const extruding = useCadStore((state) => state.extrude !== null);
  const inSupport = useCadStore((state) => state.sketchSupport !== null);

  // The active extrude task and the sketch support command each own the panel with
  // their own Confirm/Cancel actions; the header delete action only applies to a
  // selected body/feature at rest.
  const heading = inSupport || sketch ? 'Sketch' : extruding ? 'Extrude' : 'Properties';
  const selectionName = !sketch && !extruding && !inSupport ? (entity?.name ?? feature?.name ?? null) : null;

  return (
    <aside className="context-panel" aria-label="Properties">
      <div className="context-panel__header">
        <h2 className="panel-heading">{heading}</h2>
        {selectionName ? (
          <IconButton
            aria-label={`Delete ${selectionName}`}
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => deleteSelected()}
          />
        ) : null}
      </div>
      {inSupport ? (
        <SketchSupportPanel />
      ) : extruding ? (
        <ExtrudeDialog />
      ) : sketch ? (
        <SketchContextContent sketch={sketch} />
      ) : entity ? (
        <ContextPanelContent entity={entity} updateEntity={updateEntity} />
      ) : feature ? (
        <FeatureContextContent feature={feature} />
      ) : (
        <p className="context-panel__empty">No selection</p>
      )}
    </aside>
  );
}
