import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { indexSketchEntities } from '../topology.js';
import type { SolveDiagnostic } from './types.js';

type PointEntity = Extract<SketchEntity, { kind: 'point' }>;
type CircleEntity = Extract<SketchEntity, { kind: 'circle' }>;
type LineEntity = Extract<SketchEntity, { kind: 'line' }>;

/**
 * A single scalar unknown the solver may vary: a point coordinate or a circle
 * radius. Slots are laid out in a fully deterministic order (points by id then
 * circles by id, x before y) so the residual/Jacobian numbering — and thus the
 * numeric path — never depends on document entity order.
 */
export type VariableSlot =
  | { readonly kind: 'point-x'; readonly ownerId: string }
  | { readonly kind: 'point-y'; readonly ownerId: string }
  | { readonly kind: 'circle-r'; readonly ownerId: string };

/** Guard used everywhere a division by a vector length could occur. */
const LENGTH_EPSILON = 1e-12;

/**
 * A compiled constraint system: the immutable variable layout plus pure
 * functions that evaluate residuals and the analytic Jacobian at a given
 * variable vector, and reconstruct solved entities from one. The compiler
 * captures anchored-point coordinates and unreferenced entity values as
 * constants, so `evaluate` is a pure function of the variable vector alone.
 */
export interface CompiledSystem {
  readonly variables: readonly VariableSlot[];
  readonly initial: readonly number[];
  readonly residualCount: number;
  /** Returns residuals (length `residualCount`) and a dense `residualCount` x `variables.length` Jacobian. */
  evaluate(x: readonly number[]): { residuals: number[]; jacobian: number[][] };
  /** Rebuilds the sketch entity list from a variable vector, leaving anchored/unreferenced values untouched. Pure. */
  buildEntities(x: readonly number[]): SketchEntity[];
}

export type CompileResult =
  | { readonly ok: true; readonly system: CompiledSystem }
  | { readonly ok: false; readonly diagnostics: readonly SolveDiagnostic[] };

function diagnostic(
  code: SolveDiagnostic['code'],
  message: string,
  constraintIds: readonly string[] = [],
  entityIds: readonly string[] = [],
): SolveDiagnostic {
  return { code, message, constraintIds, entityIds };
}

/** Validates that every entity coordinate/dimension is finite and non-degenerate where required. */
function validateEntities(entities: readonly SketchEntity[]): SolveDiagnostic[] {
  const diagnostics: SolveDiagnostic[] = [];
  for (const entity of entities) {
    if (entity.kind === 'point') {
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) {
        diagnostics.push(
          diagnostic('non-finite-input', `Point ${entity.id} has non-finite coordinates.`, [], [entity.id]),
        );
      }
    } else if (entity.kind === 'circle') {
      if (!Number.isFinite(entity.radius)) {
        diagnostics.push(diagnostic('non-finite-input', `Circle ${entity.id} has a non-finite radius.`, [], [entity.id]));
      } else if (entity.radius < 0) {
        diagnostics.push(diagnostic('invalid-dimension', `Circle ${entity.id} has a negative radius.`, [], [entity.id]));
      }
    }
  }
  return diagnostics;
}

/** Validates that every constraint references entities of the expected kind and carries finite, in-range values. */
function validateConstraints(
  constraints: readonly SketchConstraint[],
  points: ReadonlyMap<string, PointEntity>,
  lines: ReadonlyMap<string, LineEntity>,
  circles: ReadonlyMap<string, CircleEntity>,
): SolveDiagnostic[] {
  const diagnostics: SolveDiagnostic[] = [];
  const requirePoint = (id: string, constraintId: string) => {
    if (!points.has(id)) {
      diagnostics.push(diagnostic('missing-reference', `Constraint ${constraintId} references missing point ${id}.`, [constraintId], [id]));
      return false;
    }
    return true;
  };
  const requireLine = (id: string, constraintId: string): LineEntity | undefined => {
    const line = lines.get(id);
    if (!line) {
      diagnostics.push(diagnostic('missing-reference', `Constraint ${constraintId} references missing line ${id}.`, [constraintId], [id]));
      return undefined;
    }
    // A line's own endpoints must resolve for its residual to be meaningful.
    requirePoint(line.startId, constraintId);
    requirePoint(line.endId, constraintId);
    return line;
  };

  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'coincident':
        requirePoint(constraint.pointA, constraint.id);
        requirePoint(constraint.pointB, constraint.id);
        break;
      case 'horizontal':
      case 'vertical':
        requireLine(constraint.lineId, constraint.id);
        break;
      case 'distance':
        requirePoint(constraint.pointA, constraint.id);
        requirePoint(constraint.pointB, constraint.id);
        if (!Number.isFinite(constraint.value)) {
          diagnostics.push(diagnostic('non-finite-input', `Distance constraint ${constraint.id} has a non-finite value.`, [constraint.id]));
        } else if (constraint.value < 0) {
          diagnostics.push(diagnostic('invalid-dimension', `Distance constraint ${constraint.id} has a negative value.`, [constraint.id]));
        }
        break;
      case 'radius':
        if (!circles.has(constraint.circleId)) {
          diagnostics.push(
            diagnostic('missing-reference', `Constraint ${constraint.id} references missing circle ${constraint.circleId}.`, [constraint.id], [constraint.circleId]),
          );
        }
        if (!Number.isFinite(constraint.value)) {
          diagnostics.push(diagnostic('non-finite-input', `Radius constraint ${constraint.id} has a non-finite value.`, [constraint.id]));
        } else if (constraint.value < 0) {
          diagnostics.push(diagnostic('invalid-dimension', `Radius constraint ${constraint.id} has a negative value.`, [constraint.id]));
        }
        break;
      case 'angle': {
        requireLine(constraint.lineA, constraint.id);
        requireLine(constraint.lineB, constraint.id);
        if (!Number.isFinite(constraint.valueDeg)) {
          diagnostics.push(diagnostic('non-finite-input', `Angle constraint ${constraint.id} has a non-finite value.`, [constraint.id]));
        }
        break;
      }
    }
  }
  return diagnostics;
}

/** Sorts ids into a stable lexicographic order so the variable layout is deterministic. */
function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Resolves the point/circle references a single constraint needs into their
 * variable indices (or `null` for a fixed value), so `evaluate` can fill both
 * residuals and Jacobian rows without repeating lookups per iteration.
 */
interface PointRef {
  readonly xi: number | null; // variable index for x, or null when anchored/fixed
  readonly yi: number | null;
  readonly x0: number; // fixed value used when the corresponding index is null
  readonly y0: number;
}

export function compileSystem(
  sketch: SketchFeature,
  anchoredPointIds: readonly string[],
): CompileResult {
  const entities = sketch.entities;
  const { points, lines, circles } = indexSketchEntities(entities);

  const diagnostics = [
    ...validateEntities(entities),
    ...validateConstraints(sketch.constraints, points, lines, circles),
  ];

  const anchored = new Set(anchoredPointIds);
  for (const id of anchored) {
    if (!points.has(id)) {
      diagnostics.push(diagnostic('invalid-anchor', `Anchor references missing point ${id}.`, [], [id]));
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  // Deterministic variable layout: unanchored points (x then y) by id, then circle radii by id.
  const pointIds = sortedIds(points.keys());
  const circleIds = sortedIds(circles.keys());

  const variables: VariableSlot[] = [];
  const initial: number[] = [];
  const pointXIndex = new Map<string, number>();
  const pointYIndex = new Map<string, number>();
  const circleRIndex = new Map<string, number>();

  for (const id of pointIds) {
    if (anchored.has(id)) continue;
    const point = points.get(id)!;
    pointXIndex.set(id, variables.length);
    variables.push({ kind: 'point-x', ownerId: id });
    initial.push(point.x);
    pointYIndex.set(id, variables.length);
    variables.push({ kind: 'point-y', ownerId: id });
    initial.push(point.y);
  }
  for (const id of circleIds) {
    const circle = circles.get(id)!;
    circleRIndex.set(id, variables.length);
    variables.push({ kind: 'circle-r', ownerId: id });
    initial.push(circle.radius);
  }

  const pointRef = (id: string): PointRef => {
    const point = points.get(id)!;
    const xi = pointXIndex.get(id);
    const yi = pointYIndex.get(id);
    return {
      xi: xi === undefined ? null : xi,
      yi: yi === undefined ? null : yi,
      x0: point.x,
      y0: point.y,
    };
  };

  const read = (x: readonly number[], index: number | null, fixed: number): number =>
    index === null ? fixed : x[index]!;

  // Precompute per-constraint reference data (deterministic constraint order by id).
  const orderedConstraints = [...sketch.constraints].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Compute the fixed residual count up front (every supported constraint contributes a fixed number of rows).
  let residualCount = 0;
  for (const constraint of orderedConstraints) {
    residualCount += constraint.kind === 'coincident' ? 2 : 1;
  }

  const evaluate = (x: readonly number[]): { residuals: number[]; jacobian: number[][] } => {
    const residuals: number[] = new Array<number>(residualCount).fill(0);
    const jacobian: number[][] = Array.from({ length: residualCount }, () => new Array<number>(variables.length).fill(0));
    let row = 0;
    // Accumulate (not assign) so a point appearing in both terms of a residual
    // — e.g. a vertex shared by both lines of an angle constraint — sums correctly.
    const addJ = (r: number, index: number | null, value: number) => {
      if (index === null) return;
      const jrow = jacobian[r]!;
      jrow[index] = (jrow[index] ?? 0) + value;
    };

    for (const constraint of orderedConstraints) {
      switch (constraint.kind) {
        case 'coincident': {
          const a = pointRef(constraint.pointA);
          const b = pointRef(constraint.pointB);
          // rx: xA - xB
          residuals[row] = read(x, a.xi, a.x0) - read(x, b.xi, b.x0);
          addJ(row, a.xi, 1);
          addJ(row, b.xi, -1);
          row++;
          // ry: yA - yB
          residuals[row] = read(x, a.yi, a.y0) - read(x, b.yi, b.y0);
          addJ(row, a.yi, 1);
          addJ(row, b.yi, -1);
          row++;
          break;
        }
        case 'horizontal': {
          const line = lines.get(constraint.lineId)!;
          const s = pointRef(line.startId);
          const e = pointRef(line.endId);
          // yEnd - yStart == 0
          residuals[row] = read(x, e.yi, e.y0) - read(x, s.yi, s.y0);
          addJ(row, e.yi, 1);
          addJ(row, s.yi, -1);
          row++;
          break;
        }
        case 'vertical': {
          const line = lines.get(constraint.lineId)!;
          const s = pointRef(line.startId);
          const e = pointRef(line.endId);
          // xEnd - xStart == 0
          residuals[row] = read(x, e.xi, e.x0) - read(x, s.xi, s.x0);
          addJ(row, e.xi, 1);
          addJ(row, s.xi, -1);
          row++;
          break;
        }
        case 'distance': {
          const a = pointRef(constraint.pointA);
          const b = pointRef(constraint.pointB);
          const ax = read(x, a.xi, a.x0);
          const ay = read(x, a.yi, a.y0);
          const bx = read(x, b.xi, b.x0);
          const by = read(x, b.yi, b.y0);
          const dx = bx - ax;
          const dy = by - ay;
          const dist = Math.hypot(dx, dy);
          residuals[row] = dist - constraint.value;
          const inv = dist < LENGTH_EPSILON ? 0 : 1 / dist;
          // d(dist)/d(ax) = -dx/dist, etc.
          addJ(row, a.xi, -dx * inv);
          addJ(row, a.yi, -dy * inv);
          addJ(row, b.xi, dx * inv);
          addJ(row, b.yi, dy * inv);
          row++;
          break;
        }
        case 'radius': {
          const ri = circleRIndex.get(constraint.circleId)!;
          residuals[row] = x[ri]! - constraint.value;
          jacobian[row]![ri] = 1;
          row++;
          break;
        }
        case 'angle': {
          const lineA = lines.get(constraint.lineA)!;
          const lineB = lines.get(constraint.lineB)!;
          const as = pointRef(lineA.startId);
          const ae = pointRef(lineA.endId);
          const bs = pointRef(lineB.startId);
          const be = pointRef(lineB.endId);
          const ax = read(x, ae.xi, ae.x0) - read(x, as.xi, as.x0);
          const ay = read(x, ae.yi, ae.y0) - read(x, as.yi, as.y0);
          const bx = read(x, be.xi, be.x0) - read(x, bs.xi, bs.x0);
          const by = read(x, be.yi, be.y0) - read(x, bs.yi, bs.y0);
          // theta = atan2(by, bx) - atan2(ay, ax); residual wrapped to (-pi, pi].
          const theta = Math.atan2(by, bx) - Math.atan2(ay, ax);
          const target = (constraint.valueDeg * Math.PI) / 180;
          residuals[row] = Math.atan2(Math.sin(theta - target), Math.cos(theta - target));
          const la2 = Math.max(ax * ax + ay * ay, LENGTH_EPSILON);
          const lb2 = Math.max(bx * bx + by * by, LENGTH_EPSILON);
          // d(theta)/d(ax) = ay/la2, d(theta)/d(ay) = -ax/la2 (angleA subtracted).
          const dAx = ay / la2;
          const dAy = -ax / la2;
          // d(theta)/d(bx) = -by/lb2, d(theta)/d(by) = bx/lb2 (angleB added).
          const dBx = -by / lb2;
          const dBy = bx / lb2;
          // ax = xEndA - xStartA, so end gets +d, start gets -d (same for others);
          // addJ accumulates when a vertex is shared between the two lines.
          addJ(row, ae.xi, dAx);
          addJ(row, as.xi, -dAx);
          addJ(row, ae.yi, dAy);
          addJ(row, as.yi, -dAy);
          addJ(row, be.xi, dBx);
          addJ(row, bs.xi, -dBx);
          addJ(row, be.yi, dBy);
          addJ(row, bs.yi, -dBy);
          row++;
          break;
        }
      }
    }
    return { residuals, jacobian };
  };

  const buildEntities = (x: readonly number[]): SketchEntity[] =>
    entities.map((entity) => {
      if (entity.kind === 'point') {
        const xi = pointXIndex.get(entity.id);
        const yi = pointYIndex.get(entity.id);
        if (xi === undefined || yi === undefined) return { ...entity };
        return { ...entity, x: x[xi]!, y: x[yi]! };
      }
      if (entity.kind === 'circle') {
        const ri = circleRIndex.get(entity.id);
        if (ri === undefined) return { ...entity };
        return { ...entity, radius: x[ri]! };
      }
      return { ...entity };
    });

  return {
    ok: true,
    system: { variables, initial, residualCount, evaluate, buildEntities },
  };
}
