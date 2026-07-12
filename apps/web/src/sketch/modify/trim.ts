import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import {
  distance,
  pointAtArcParam,
  pointAtLineParam,
  projectToCurve,
  arcParamAngle,
  targetSplitParams,
  POINT_MERGE_TOLERANCE,
  type Point,
  type ResolvedCurve,
} from './curves.js';

/**
 * Deterministic, side-effect-free Trim for sketch lines and circular arcs. A
 * target curve is divided at every interior intersection with the other sketch
 * curves; the single bounded piece under the click is removed and the remaining
 * pieces are re-emitted as concrete line/arc entities. Endpoint-adjacent pieces
 * simply shorten the curve (the far endpoint's point id and its constraints are
 * preserved); a piece between two interior intersections leaves a gap and yields
 * two entities. When a boundary lands on an existing point it is fused onto that
 * point (an implicit vertex) so trimming to a shared corner closes the loop.
 * The whole edit is one `{entities, constraints}` result the store applies through
 * a single history command, so undo/redo restores exact ids and constraints.
 */

/** Why a trim could not run (no mutation happens in these cases). */
export type TrimRejection = 'no-target' | 'no-intersections';

export interface TrimPlan {
  readonly target: ResolvedCurve;
  /** Sorted split params including the two endpoints: [0, ...interior, 1]. */
  readonly boundaries: readonly number[];
  /** Index of the piece (between boundaries[i] and boundaries[i+1]) that the click removes. */
  readonly removedIndex: number;
  /** Sampled plane-local polyline of the removed piece, for the preview highlight. */
  readonly removedPolyline: readonly Point[];
}

export type TrimResult =
  | { readonly ok: true; readonly plan: TrimPlan }
  | { readonly ok: false; readonly reason: TrimRejection; readonly message: string };

const REMOVED_ARC_SAMPLES = 24;

function samplePiece(target: ResolvedCurve, t0: number, t1: number): Point[] {
  if (target.kind === 'line') {
    return [pointAtLineParam(target.a, target.b, t0), pointAtLineParam(target.a, target.b, t1)];
  }
  const points: Point[] = [];
  for (let i = 0; i <= REMOVED_ARC_SAMPLES; i++) {
    points.push(pointAtArcParam(target.arc, t0 + ((t1 - t0) * i) / REMOVED_ARC_SAMPLES));
  }
  return points;
}

/** Locates the piece a click param falls in, given the sorted boundary params. */
function pieceIndexForParam(boundaries: readonly number[], t: number): number {
  for (let i = boundaries.length - 2; i >= 0; i--) {
    if (t >= boundaries[i]!) return i;
  }
  return 0;
}

/** Plans a trim of `target` at the given plane-local click point. Pure — never mutates. */
export function computeTrim(sketch: SketchFeature, target: ResolvedCurve, clickPoint: Point): TrimResult {
  const interior = targetSplitParams(sketch, target);
  if (interior.length === 0) {
    return { ok: false, reason: 'no-intersections', message: 'No intersections here to trim against.' };
  }
  const boundaries = [0, ...interior, 1];
  const clickParam = projectToCurve(target, clickPoint).t;
  const removedIndex = pieceIndexForParam(boundaries, clickParam);
  const removedPolyline = samplePiece(target, boundaries[removedIndex]!, boundaries[removedIndex + 1]!);
  return { ok: true, plan: { target, boundaries, removedIndex, removedPolyline } };
}

/** All point ids referenced by any line/circle/arc in a list of entities. */
function referencedPointIds(entities: readonly SketchEntity[]): Set<string> {
  const ids = new Set<string>();
  for (const entity of entities) {
    if (entity.kind === 'line') {
      ids.add(entity.startId);
      ids.add(entity.endId);
    } else if (entity.kind === 'circle' || entity.kind === 'arc') {
      ids.add(entity.centerId);
    }
  }
  return ids;
}

/** Every point id a constraint depends on, so it can be dropped when one is removed. */
function constraintPointRefs(constraint: SketchConstraint): string[] {
  if (constraint.kind === 'coincident' || constraint.kind === 'distance') return [constraint.pointA, constraint.pointB];
  return [];
}

export interface SketchEdit {
  readonly entities: SketchEntity[];
  readonly constraints: SketchConstraint[];
}

/**
 * Materialises a {@link TrimPlan} into the new entity and constraint arrays. New
 * ids come from `createId` in a fixed order (interior boundary points ascending,
 * then new line pieces, then remapped horizontal/vertical constraints) so a
 * deterministic id generator yields deterministic output.
 */
export function applyTrim(sketch: SketchFeature, plan: TrimPlan, createId: () => string): SketchEdit {
  return plan.target.kind === 'line'
    ? applyLineTrim(sketch, plan, plan.target, createId)
    : applyArcTrim(sketch, plan, plan.target, createId);
}

function findExistingPointId(sketch: SketchFeature, coord: Point): string | null {
  let match: string | null = null;
  for (const entity of sketch.entities) {
    if (entity.kind !== 'point') continue;
    if (distance([entity.x, entity.y], coord) <= POINT_MERGE_TOLERANCE) {
      if (match === null || entity.id < match) match = entity.id;
    }
  }
  return match;
}

function applyLineTrim(
  sketch: SketchFeature,
  plan: TrimPlan,
  target: Extract<ResolvedCurve, { kind: 'line' }>,
  createId: () => string,
): SketchEdit {
  const { boundaries, removedIndex } = plan;
  const lastBoundary = boundaries.length - 1;
  const keptPieces = boundaries.slice(0, -1).map((_, index) => index).filter((index) => index !== removedIndex);

  // Resolve a point id for every boundary index that a kept piece touches.
  const usedBoundaries = [...new Set(keptPieces.flatMap((j) => [j, j + 1]))].sort((a, b) => a - b);
  const newPoints: SketchEntity[] = [];
  const boundaryPointId = new Map<number, string>();
  for (const i of usedBoundaries) {
    if (i === 0) {
      boundaryPointId.set(i, target.startId);
    } else if (i === lastBoundary) {
      boundaryPointId.set(i, target.endId);
    } else {
      const coord = pointAtLineParam(target.a, target.b, boundaries[i]!);
      const existing = findExistingPointId(sketch, coord);
      if (existing) {
        boundaryPointId.set(i, existing);
      } else {
        const id = createId();
        newPoints.push({ id, kind: 'point', x: coord[0], y: coord[1], construction: target.construction });
        boundaryPointId.set(i, id);
      }
    }
  }

  // Emit a line per kept piece; the first kept piece keeps the original line id.
  const keptLines: Extract<SketchEntity, { kind: 'line' }>[] = [];
  keptPieces.forEach((j, order) => {
    const startId = boundaryPointId.get(j)!;
    const endId = boundaryPointId.get(j + 1)!;
    if (startId === endId) return;
    const id = order === 0 ? target.id : createId();
    keptLines.push({ id, kind: 'line', startId, endId, construction: target.construction });
  });

  // Assemble entities: everything except the target, plus new points and kept lines.
  let entities: SketchEntity[] = sketch.entities.filter((entity) => entity.id !== target.id);
  entities = [...entities, ...newPoints, ...keptLines];

  // Drop the original endpoints that nothing references any more.
  const referenced = referencedPointIds(entities);
  const removedPointIds = new Set<string>();
  for (const endpointId of [target.startId, target.endId]) {
    if (!referenced.has(endpointId)) {
      entities = entities.filter((entity) => entity.id !== endpointId);
      removedPointIds.add(endpointId);
    }
  }

  const keptLineIds = keptLines.map((line) => line.id);
  const additionalLineIds = keptLineIds.filter((id) => id !== target.id);
  const constraints = remapLineConstraints(sketch.constraints, target.id, additionalLineIds, removedPointIds, createId);

  return { entities, constraints };
}

/** Remaps a trimmed/split line's constraints: drop those on removed points, keep those on the retained id, and copy horizontal/vertical onto each new collinear piece. */
function remapLineConstraints(
  original: readonly SketchConstraint[],
  originalLineId: string,
  additionalLineIds: readonly string[],
  removedPointIds: ReadonlySet<string>,
  createId: () => string,
): SketchConstraint[] {
  const kept: SketchConstraint[] = [];
  const duplicated: SketchConstraint[] = [];
  for (const constraint of original) {
    if (constraintPointRefs(constraint).some((ref) => removedPointIds.has(ref))) continue;
    kept.push(constraint);
    if ((constraint.kind === 'horizontal' || constraint.kind === 'vertical') && constraint.lineId === originalLineId) {
      for (const lineId of additionalLineIds) {
        duplicated.push({ id: createId(), kind: constraint.kind, lineId });
      }
    }
  }
  return [...kept, ...duplicated];
}

function applyArcTrim(
  sketch: SketchFeature,
  plan: TrimPlan,
  target: Extract<ResolvedCurve, { kind: 'arc' }>,
  createId: () => string,
): SketchEdit {
  const { boundaries, removedIndex } = plan;
  const keptPieces = boundaries.slice(0, -1).map((_, index) => index).filter((index) => index !== removedIndex);

  const keptArcs: SketchEntity[] = [];
  keptPieces.forEach((j, order) => {
    const startAngle = arcParamAngle(target.arc, boundaries[j]!);
    const endAngle = arcParamAngle(target.arc, boundaries[j + 1]!);
    if (startAngle === endAngle) return;
    keptArcs.push({
      id: order === 0 ? target.id : createId(),
      kind: 'arc',
      centerId: target.centerId,
      radius: target.arc.radius,
      startAngle,
      endAngle,
      direction: target.direction,
      construction: target.construction,
    });
  });

  const entities = [...sketch.entities.filter((entity) => entity.id !== target.id), ...keptArcs];
  // Arcs reference only their (preserved) centre point, so no constraint references break.
  return { entities, constraints: [...sketch.constraints] };
}
