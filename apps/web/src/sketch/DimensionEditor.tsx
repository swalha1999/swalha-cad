import type { SketchConstraint } from '@swalha-cad/document';
import { NumericField } from '../components/NumericField.js';
import { useCadStore } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import { constraintUnit, constraintValue } from './constraint-actions.js';

const KIND_LABEL: Record<SketchConstraint['kind'], string> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  distance: 'Distance',
  radius: 'Radius',
  angle: 'Angle',
};

/**
 * Numeric editor for the selected dimensional constraint (distance/radius in mm,
 * angle in degrees). Editing routes through the store, which validates the value
 * and re-solves the sketch through history; an invalid value is rejected inline
 * without touching the geometry. Geometric constraints and an empty selection
 * render a short hint instead of a field.
 */
export function DimensionEditor() {
  const sketch = useCadStore(selectActiveSketch);
  const selectedConstraintId = useCadStore((state) => state.selectedConstraintId);
  const editConstraintValue = useCadStore((state) => state.editConstraintValue);

  const constraint = sketch?.constraints.find((candidate) => candidate.id === selectedConstraintId);
  const value = constraint ? constraintValue(constraint) : null;
  const unit = constraint ? constraintUnit(constraint) : null;

  if (!constraint || value === null || unit === null) {
    return (
      <p className="dimension-editor__hint" data-testid="dimension-editor-hint">
        Select a dimension to edit its value.
      </p>
    );
  }

  return (
    <div className="dimension-editor" aria-label="Dimension editor" role="group">
      <NumericField
        label={`${KIND_LABEL[constraint.kind]} value`}
        value={value}
        unit={unit === 'deg' ? '°' : 'mm'}
        onCommit={(next) => editConstraintValue(constraint.id, next).applied}
      />
    </div>
  );
}
