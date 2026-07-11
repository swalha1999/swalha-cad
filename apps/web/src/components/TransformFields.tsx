import type { Transform, Vec3 } from '@swalha-cad/document';
import { NumericField } from './NumericField.js';

export interface TransformFieldsProps {
  transform: Transform;
  onCommit: (next: Transform) => boolean;
}

function withAxis(vec: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const next: [number, number, number] = [...vec];
  next[axis] = value;
  return next;
}

interface AxisFieldConfig {
  axis: 0 | 1 | 2;
  label: string;
}

const AXES: AxisFieldConfig[] = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
];

/** Numeric translate/rotate/scale fields for one entity, kept in sync with the viewport transform gizmo via the shared store. */
export function TransformFields({ transform, onCommit }: TransformFieldsProps) {
  return (
    <>
      {AXES.map(({ axis, label }) => (
        <NumericField
          key={`translate-${label}`}
          label={`Translate ${label}`}
          value={transform.translation[axis]}
          unit="mm"
          onCommit={(next) => onCommit({ ...transform, translation: withAxis(transform.translation, axis, next) })}
        />
      ))}
      {AXES.map(({ axis, label }) => (
        <NumericField
          key={`rotate-${label}`}
          label={`Rotate ${label}`}
          value={transform.rotationDeg[axis]}
          unit="deg"
          onCommit={(next) => onCommit({ ...transform, rotationDeg: withAxis(transform.rotationDeg, axis, next) })}
        />
      ))}
      {AXES.map(({ axis, label }) => (
        <NumericField
          key={`scale-${label}`}
          label={`Scale ${label}`}
          value={transform.scale[axis]}
          onCommit={(next) => onCommit({ ...transform, scale: withAxis(transform.scale, axis, next) })}
        />
      ))}
    </>
  );
}
