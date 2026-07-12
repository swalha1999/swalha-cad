import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';

/** The six scoped M2 constraint kinds. */
export type ConstraintKind = SketchConstraint['kind'];

/** `Omit` that distributes over a union so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A constraint without its id — the store assigns the id when applying it through history. */
export type NewConstraint = DistributiveOmit<SketchConstraint, 'id'>;

/** Selected sketch entity ids grouped by kind, in selection order. */
export interface ClassifiedSelection {
  points: string[];
  lines: string[];
  circles: string[];
}

type PointEntity = Extract<SketchEntity, { kind: 'point' }>;
type LineEntity = Extract<SketchEntity, { kind: 'line' }>;
type CircleEntity = Extract<SketchEntity, { kind: 'circle' }>;

const ANGLE_EPSILON_DEG = 1e-6;

function entityIndex(sketch: SketchFeature) {
  const points = new Map<string, PointEntity>();
  const lines = new Map<string, LineEntity>();
  const circles = new Map<string, CircleEntity>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') points.set(entity.id, entity);
    else if (entity.kind === 'line') lines.set(entity.id, entity);
    else if (entity.kind === 'circle') circles.set(entity.id, entity);
  }
  return { points, lines, circles };
}

/** Groups selected ids by entity kind, dropping ids that no longer resolve to an entity. */
export function classifySelection(sketch: SketchFeature, selection: readonly string[]): ClassifiedSelection {
  const { points, lines, circles } = entityIndex(sketch);
  const result: ClassifiedSelection = { points: [], lines: [], circles: [] };
  for (const id of selection) {
    if (points.has(id)) result.points.push(id);
    else if (lines.has(id)) result.lines.push(id);
    else if (circles.has(id)) result.circles.push(id);
  }
  return result;
}

/** Whether the selection contains only the listed counts of each kind. */
function isExactly(selection: ClassifiedSelection, points: number, lines: number, circles: number): boolean {
  return selection.points.length === points && selection.lines.length === lines && selection.circles.length === circles;
}

/**
 * Which constraint kinds the current selection is eligible for. Each dimensional
 * or geometric constraint requires a specific, unambiguous selection shape so the
 * toolbar can enable exactly the applicable buttons.
 */
export function constraintEligibility(sketch: SketchFeature, selection: readonly string[]): Record<ConstraintKind, boolean> {
  const s = classifySelection(sketch, selection);
  const singleLine = isExactly(s, 0, 1, 0);
  return {
    coincident: isExactly(s, 2, 0, 0),
    horizontal: singleLine,
    vertical: singleLine,
    distance: isExactly(s, 2, 0, 0) || singleLine,
    radius: isExactly(s, 0, 0, 1),
    angle: isExactly(s, 0, 2, 0),
  };
}

function lineDirection(sketch: SketchFeature, lineId: string): { x: number; y: number } | null {
  const { points, lines } = entityIndex(sketch);
  const line = lines.get(lineId);
  if (!line) return null;
  const start = points.get(line.startId);
  const end = points.get(line.endId);
  if (!start || !end) return null;
  return { x: end.x - start.x, y: end.y - start.y };
}

/**
 * Signed angle (degrees, wrapped to (-180, 180]) rotating from `lineA` to
 * `lineB`, matching the solver's `atan2(dirB) - atan2(dirA)` convention. Returns
 * `null` when either line is missing or degenerate.
 */
export function measureSignedAngleDeg(sketch: SketchFeature, lineA: string, lineB: string): number | null {
  const a = lineDirection(sketch, lineA);
  const b = lineDirection(sketch, lineB);
  if (!a || !b) return null;
  const theta = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
  const wrapped = Math.atan2(Math.sin(theta), Math.cos(theta));
  return (wrapped * 180) / Math.PI;
}

function pointDistance(sketch: SketchFeature, pointA: string, pointB: string): number | null {
  const { points } = entityIndex(sketch);
  const a = points.get(pointA);
  const b = points.get(pointB);
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Builds a fully-typed constraint (minus id) from the current selection and the
 * measured geometry, or `null` when the selection is ineligible or the measured
 * value is degenerate (zero-length distance, parallel/anti-parallel angle). The
 * measured value keeps a freshly applied dimension consistent with the geometry
 * it was taken from; the user can then edit it through the dimension editor.
 */
export function buildConstraintForSelection(sketch: SketchFeature, selection: readonly string[], kind: ConstraintKind): NewConstraint | null {
  if (!constraintEligibility(sketch, selection)[kind]) return null;
  const s = classifySelection(sketch, selection);
  const { lines } = entityIndex(sketch);

  switch (kind) {
    case 'coincident':
      return { kind, pointA: s.points[0]!, pointB: s.points[1]! };
    case 'horizontal':
      return { kind, lineId: s.lines[0]! };
    case 'vertical':
      return { kind, lineId: s.lines[0]! };
    case 'distance': {
      const [pointA, pointB] = s.lines.length === 1 ? [lines.get(s.lines[0]!)!.startId, lines.get(s.lines[0]!)!.endId] : [s.points[0]!, s.points[1]!];
      const value = pointDistance(sketch, pointA, pointB);
      if (value === null || value <= 0) return null;
      return { kind, pointA, pointB, value };
    }
    case 'radius': {
      const { circles } = entityIndex(sketch);
      const circle = circles.get(s.circles[0]!);
      if (!circle) return null;
      return { kind, circleId: circle.id, value: circle.radius };
    }
    case 'angle': {
      let [lineA, lineB] = [s.lines[0]!, s.lines[1]!];
      let signed = measureSignedAngleDeg(sketch, lineA, lineB);
      if (signed === null) return null;
      // Keep the stored value in the schema's open (0, 180) range by orienting the
      // pair so the signed angle is positive; a swap negates the measured angle.
      if (signed < 0) {
        [lineA, lineB] = [lineB, lineA];
        signed = -signed;
      }
      if (signed <= ANGLE_EPSILON_DEG || signed >= 180 - ANGLE_EPSILON_DEG) return null;
      return { kind, lineA, lineB, valueDeg: signed };
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown constraint kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The value field a dimensional constraint edits, or `null` for the geometric ones. */
export function constraintValue(constraint: SketchConstraint): number | null {
  switch (constraint.kind) {
    case 'distance':
    case 'radius':
      return constraint.value;
    case 'angle':
      return constraint.valueDeg;
    default:
      return null;
  }
}

/** The unit a dimensional constraint's value is edited in. */
export function constraintUnit(constraint: SketchConstraint): 'mm' | 'deg' | null {
  switch (constraint.kind) {
    case 'distance':
    case 'radius':
      return 'mm';
    case 'angle':
      return 'deg';
    default:
      return null;
  }
}
