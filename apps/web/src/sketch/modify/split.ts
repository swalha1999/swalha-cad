import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import {
  arcParamAngle,
  curvePointAtParam,
  projectToCurve,
  PARAM_EPSILON,
  type Point,
  type ResolvedCurve,
} from './curves.js';
import type { SketchEdit } from './trim.js';

/**
 * Deterministic, side-effect-free Split for sketch lines and circular arcs. A
 * click is projected onto the target curve at a strictly interior param and the
 * curve is replaced by two entities that meet there: a line becomes two lines
 * sharing a freshly created coincident point; an arc becomes two arcs sharing the
 * split angle about the preserved centre. Construction state is preserved and the
 * first piece keeps the original entity id, so any constraint on the line id (and
 * every endpoint constraint) survives — horizontal/vertical constraints are copied
 * onto the second, still-collinear piece. One `{entities, constraints}` result the
 * store applies through a single history command.
 */

export type SplitRejection = 'no-target' | 'not-interior';

export interface SplitPlan {
  readonly target: ResolvedCurve;
  /** Strictly interior normalised position of the split along the target. */
  readonly t: number;
  /** Plane-local point the two new entities meet at. */
  readonly point: Point;
}

export type SplitResult =
  | { readonly ok: true; readonly plan: SplitPlan }
  | { readonly ok: false; readonly reason: SplitRejection; readonly message: string };

/** Plans a split of `target` at the given plane-local click point. Pure — never mutates. */
export function computeSplit(sketch: SketchFeature, target: ResolvedCurve, clickPoint: Point): SplitResult {
  const t = projectToCurve(target, clickPoint).t;
  if (t <= PARAM_EPSILON || t >= 1 - PARAM_EPSILON) {
    return { ok: false, reason: 'not-interior', message: 'Click on the interior of a line or arc to split it.' };
  }
  return { ok: true, plan: { target, t, point: curvePointAtParam(target, t) } };
}

/** Materialises a {@link SplitPlan} into the new entity and constraint arrays. */
export function applySplit(sketch: SketchFeature, plan: SplitPlan, createId: () => string): SketchEdit {
  return plan.target.kind === 'line'
    ? applyLineSplit(sketch, plan, plan.target, createId)
    : applyArcSplit(sketch, plan, plan.target, createId);
}

function applyLineSplit(
  sketch: SketchFeature,
  plan: SplitPlan,
  target: Extract<ResolvedCurve, { kind: 'line' }>,
  createId: () => string,
): SketchEdit {
  const splitPoint: SketchEntity = {
    id: createId(),
    kind: 'point',
    x: plan.point[0],
    y: plan.point[1],
    construction: target.construction,
  };
  const first: SketchEntity = { id: target.id, kind: 'line', startId: target.startId, endId: splitPoint.id, construction: target.construction };
  const second: SketchEntity = { id: createId(), kind: 'line', startId: splitPoint.id, endId: target.endId, construction: target.construction };

  const entities = [...sketch.entities.filter((entity) => entity.id !== target.id), splitPoint, first, second];

  // Copy horizontal/vertical constraints onto the new (still collinear) second piece.
  const duplicated: SketchConstraint[] = [];
  for (const constraint of sketch.constraints) {
    if ((constraint.kind === 'horizontal' || constraint.kind === 'vertical') && constraint.lineId === target.id) {
      duplicated.push({ id: createId(), kind: constraint.kind, lineId: second.id });
    }
  }
  return { entities, constraints: [...sketch.constraints, ...duplicated] };
}

function applyArcSplit(
  sketch: SketchFeature,
  plan: SplitPlan,
  target: Extract<ResolvedCurve, { kind: 'arc' }>,
  createId: () => string,
): SketchEdit {
  const splitAngle = arcParamAngle(target.arc, plan.t);
  const first: SketchEntity = {
    id: target.id,
    kind: 'arc',
    centerId: target.centerId,
    radius: target.arc.radius,
    startAngle: target.arc.startAngle,
    endAngle: splitAngle,
    direction: target.direction,
    construction: target.construction,
  };
  const second: SketchEntity = {
    id: createId(),
    kind: 'arc',
    centerId: target.centerId,
    radius: target.arc.radius,
    startAngle: splitAngle,
    endAngle: target.arc.endAngle,
    direction: target.direction,
    construction: target.construction,
  };
  const entities = [...sketch.entities.filter((entity) => entity.id !== target.id), first, second];
  return { entities, constraints: [...sketch.constraints] };
}
