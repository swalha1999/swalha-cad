import { Diameter, Link2, MoveHorizontal, MoveVertical, Ruler, Triangle } from 'lucide-react';
import type { ComponentType } from 'react';
import { IconButton } from '../components/ui/IconButton.js';
import { Tooltip } from '../components/ui/Tooltip.js';
import { useCadStore } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import type { ConstraintKind } from './constraint-actions.js';
import { buildConstraintForSelection, constraintEligibility } from './constraint-actions.js';

interface ConstraintButton {
  kind: ConstraintKind;
  label: string;
  icon: ComponentType;
}

const CONSTRAINTS: ConstraintButton[] = [
  { kind: 'coincident', label: 'Coincident', icon: Link2 },
  { kind: 'horizontal', label: 'Horizontal', icon: MoveHorizontal },
  { kind: 'vertical', label: 'Vertical', icon: MoveVertical },
  { kind: 'distance', label: 'Distance', icon: Ruler },
  { kind: 'radius', label: 'Radius', icon: Diameter },
  { kind: 'angle', label: 'Angle', icon: Triangle },
];

/**
 * The constraint toolbar shown while sketching: one button per scoped M2
 * constraint, each enabled only when the current sketch selection is eligible.
 * Applying a constraint routes through the store (a `feature.update` command),
 * re-solves the sketch, and clears the selection so the next constraint starts
 * fresh. Geometric constraints (coincidence/horizontal/vertical) and dimensional
 * ones (distance/radius/angle) share the same selection-driven flow; dimensional
 * constraints are seeded with the measured value and edited in the properties
 * panel afterwards.
 */
export function ConstraintToolbar() {
  const sketch = useCadStore(selectActiveSketch);
  const selection = useCadStore((state) => state.sketchSelection);
  const applyConstraint = useCadStore((state) => state.applyConstraint);
  const clearSketchSelection = useCadStore((state) => state.clearSketchSelection);

  if (!sketch) return null;
  const eligibility = constraintEligibility(sketch, selection);

  const handleApply = (kind: ConstraintKind): void => {
    const constraint = buildConstraintForSelection(sketch, selection, kind);
    if (!constraint) return;
    applyConstraint(constraint);
    clearSketchSelection();
  };

  return (
    <div className="constraint-toolbar" role="toolbar" aria-label="Constraints">
      {CONSTRAINTS.map(({ kind, label, icon: Icon }) => (
        <Tooltip key={kind} content={label}>
          <IconButton aria-label={`${label} constraint`} disabled={!eligibility[kind]} icon={<Icon />} onClick={() => handleApply(kind)} />
        </Tooltip>
      ))}
    </div>
  );
}
