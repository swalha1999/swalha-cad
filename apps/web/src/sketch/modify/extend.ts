import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { signedArcSweep, type ArcDirection, type ArcGeometry } from '@swalha-cad/geometry';
import {
  arcParamOfPoint,
  distance,
  pointAtArcParam,
  resolveBoundaries,
  type BoundaryCurve,
  type Point,
  type ResolvedCurve,
} from './curves.js';
import { constraintPointRefs, findExistingPointId, referencedPointIds, type SketchEdit } from './trim.js';

/**
 * Deterministic, side-effect-free Extend for sketch lines and circular arcs. The
 * endpoint nearest the cursor is grown outward — a line continues collinearly, an
 * arc continues along its own circle in its existing sweep direction — to the
 * nearest geometrically valid intersection with another visible sketch curve in
 * that travel direction. The center/radius of an arc and the fixed endpoint of a
 * line never move; only the extended end reaches the boundary. When the boundary
 * lands on an existing point the line fuses onto it (so extending a short edge to a
 * shared corner closes a loop). Construction geometry may act as a boundary but is
 * never itself extended into a profile. The whole edit is one `{entities,
 * constraints}` result the store applies through a single history command, so
 * undo/redo restores exact ids, geometry and constraints. Every degenerate case
 * (no forward hit, tangent graze, collinear overlap, endpoint ambiguity, or an
 * effectively-infinite reach) is refused with a clear diagnostic and mutates
 * nothing — the extension never silently lands behind the chosen endpoint.
 */

const TWO_PI = Math.PI * 2;

/** Strictly-forward distance a hit must exceed (mm) so the endpoint itself never counts. */
const FORWARD_EPS = 1e-7;
/** Strictly-forward angular offset (rad) an arc hit must exceed so the endpoint itself never counts. */
const FORWARD_ANG_EPS = 1e-9;
/** Slack (fraction) for the "within the boundary segment" test at each end. */
const U_TOL = 1e-9;
/** Slack (param) for the "within the boundary arc's sweep" test at each end. */
const PARAM_TOL = 1e-7;
/** A point this far (mm) or less from a support line is treated as collinear with it. */
const COLLINEAR_DIST = 1e-6;
/** Below this the line-crossing denominator is treated as exactly parallel. */
const DENOM_EPS = 1e-12;
/** Negative-discriminant slack (mm²) so a grazing circle root still resolves. */
const DISC_NEG = 1e-9;
/** Two circle roots closer than this (mm) are a tangent graze, not a clean crossing. */
const TANGENT_SEP = 1e-3;
/** Cursor within this distance (mm) of both endpoints makes the choice of end ambiguous. */
const ENDPOINT_TIE_TOL = 1e-6;
/** Angular slack (rad) shaved off an arc's remaining sweep so it cannot self-close into a full circle. */
const ARC_OFFSET_EPS = 1e-6;
/** A forward hit farther than this (mm) is treated as effectively infinite (a near-parallel reach). */
export const EXTEND_MAX_DISTANCE = 1e6;

/** Why an extend could not run (nothing is mutated in these cases). */
export type ExtendRejection =
  | 'no-target'
  | 'no-forward-hit'
  | 'tangent'
  | 'overlap'
  | 'ambiguous'
  | 'effectively-infinite';

/** A resolved, committable plan to extend one endpoint of a curve to a boundary. */
export interface ExtendPlan {
  readonly target: ResolvedCurve;
  /** Which end of the target the cursor selected and the extension grows from. */
  readonly movedEnd: 'start' | 'end';
  /** The endpoint being extended (its pre-extension position). */
  readonly endpoint: Point;
  /** The boundary intersection the extension reaches. */
  readonly hitPoint: Point;
  /** The entity id of the boundary curve the extension lands on. */
  readonly boundaryId: string;
  /** Sampled plane-local polyline of just the added extension, for the preview highlight. */
  readonly extensionPolyline: readonly Point[];
}

export type ExtendResult =
  | { readonly ok: true; readonly plan: ExtendPlan }
  | { readonly ok: false; readonly reason: ExtendRejection; readonly message: string };

function reject(reason: ExtendRejection, message: string): ExtendResult {
  return { ok: false, reason, message };
}

// --- Support (the forward extension of the chosen endpoint) ---------------------

interface LineSupport {
  readonly kind: 'line';
  readonly origin: Point;
  /** Unit outward travel direction from the endpoint. */
  readonly dir: Point;
}

interface ArcSupport {
  readonly kind: 'arc';
  readonly center: Point;
  readonly radius: number;
  /** Angle (rad) of the endpoint the extension starts from. */
  readonly startAngle: number;
  /** +1 when the forward sweep is counter-clockwise, −1 when clockwise. */
  readonly sigma: 1 | -1;
  /** Maximum forward angular offset (rad) before the arc would self-close. */
  readonly maxOffset: number;
  readonly origin: Point;
}

type Support = LineSupport | ArcSupport;

interface Hit {
  readonly point: Point;
  /** Forward distance (mm) from the endpoint along the support. */
  readonly distance: number;
  readonly boundaryId: string;
  readonly tangent: boolean;
}

/** The two endpoints of a resolved curve, in start→end order. */
function endpointsOf(curve: ResolvedCurve): { start: Point; end: Point } {
  if (curve.kind === 'line') return { start: curve.a, end: curve.b };
  return { start: pointAtArcParam(curve.arc, 0), end: pointAtArcParam(curve.arc, 1) };
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}
function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1];
}
/** z-component of the 2D cross product a×b. */
function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}
function wrap(angle: number): number {
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

function buildSupport(target: ResolvedCurve, movedEnd: 'start' | 'end'): Support {
  const ends = endpointsOf(target);
  if (target.kind === 'line') {
    const origin = movedEnd === 'start' ? ends.start : ends.end;
    const opposite = movedEnd === 'start' ? ends.end : ends.start;
    const raw = sub(origin, opposite);
    const len = Math.hypot(raw[0], raw[1]);
    const dir: Point = len === 0 ? [1, 0] : [raw[0] / len, raw[1] / len];
    return { kind: 'line', origin, dir };
  }
  const arc = target.arc;
  const existingSweep = Math.abs(signedArcSweep(arc));
  const startAngle = movedEnd === 'end' ? arc.endAngle : arc.startAngle;
  const forwardDir: ArcDirection = movedEnd === 'end' ? arc.direction : arc.direction === 'ccw' ? 'cw' : 'ccw';
  const sigma: 1 | -1 = forwardDir === 'ccw' ? 1 : -1;
  const maxOffset = Math.max(0, TWO_PI - existingSweep - ARC_OFFSET_EPS);
  return {
    kind: 'arc',
    center: arc.center,
    radius: arc.radius,
    startAngle,
    sigma,
    maxOffset,
    origin: movedEnd === 'end' ? ends.end : ends.start,
  };
}

/** The forward angular offset (rad) of a point on the arc support, or `null` when behind or past the reach. */
function arcForwardOffset(support: ArcSupport, point: Point): number | null {
  const phi = Math.atan2(point[1] - support.center[1], point[0] - support.center[0]);
  const delta = support.sigma > 0 ? wrap(phi - support.startAngle) : wrap(support.startAngle - phi);
  if (delta > FORWARD_ANG_EPS && delta <= support.maxOffset) return delta;
  return null;
}

// --- Support × boundary intersection --------------------------------------------

interface BoundaryHits {
  readonly hits: readonly Hit[];
  /** The boundary lies collinear/co-circular with the support and overlaps it forward. */
  readonly overlapForward: boolean;
}

const NO_HITS: BoundaryHits = { hits: [], overlapForward: false };

/** True when a point (already on the boundary's circle) lies within the boundary arc's own sweep. */
function onBoundaryArc(arc: ArcGeometry, point: Point): boolean {
  const t = arcParamOfPoint(arc, point);
  return t >= -PARAM_TOL && t <= 1 + PARAM_TOL;
}

function lineVsLine(support: LineSupport, boundary: Extract<BoundaryCurve, { kind: 'line' }>): BoundaryHits {
  const { origin: E, dir } = support;
  const e = sub(boundary.b, boundary.a);
  const toC = sub(boundary.a, E);
  const perpC = Math.abs(cross(sub(boundary.a, E), dir));
  const perpD = Math.abs(cross(sub(boundary.b, E), dir));
  if (perpC <= COLLINEAR_DIST && perpD <= COLLINEAR_DIST) {
    const sC = dot(sub(boundary.a, E), dir);
    const sD = dot(sub(boundary.b, E), dir);
    return { hits: [], overlapForward: Math.max(sC, sD) > FORWARD_EPS };
  }
  const denom = cross(dir, e);
  if (Math.abs(denom) <= DENOM_EPS) return NO_HITS;
  const s = cross(toC, e) / denom;
  const u = cross(toC, dir) / denom;
  if (s > FORWARD_EPS && u >= -U_TOL && u <= 1 + U_TOL) {
    const point: Point = [E[0] + s * dir[0], E[1] + s * dir[1]];
    return { hits: [{ point, distance: s, boundaryId: boundary.id, tangent: false }], overlapForward: false };
  }
  return NO_HITS;
}

function lineVsArc(support: LineSupport, boundary: Extract<BoundaryCurve, { kind: 'arc' }>): BoundaryHits {
  const { origin: E, dir } = support;
  const arc = boundary.arc;
  const f = sub(E, arc.center);
  const b = 2 * dot(f, dir);
  const c = dot(f, f) - arc.radius * arc.radius;
  const disc = b * b - 4 * c;
  if (disc < -DISC_NEG) return NO_HITS;
  const root = Math.sqrt(Math.max(disc, 0));
  const roots = [(-b - root) / 2, (-b + root) / 2];
  const p0: Point = [E[0] + roots[0]! * dir[0], E[1] + roots[0]! * dir[1]];
  const p1: Point = [E[0] + roots[1]! * dir[0], E[1] + roots[1]! * dir[1]];
  const tangent = distance(p0, p1) <= TANGENT_SEP;
  const hits: Hit[] = [];
  for (const s of roots) {
    if (s <= FORWARD_EPS) continue;
    const point: Point = [E[0] + s * dir[0], E[1] + s * dir[1]];
    if (onBoundaryArc(arc, point)) hits.push({ point, distance: s, boundaryId: boundary.id, tangent });
  }
  return { hits, overlapForward: false };
}

function arcVsLine(support: ArcSupport, boundary: Extract<BoundaryCurve, { kind: 'line' }>): BoundaryHits {
  const d0 = sub(boundary.b, boundary.a);
  const A = dot(d0, d0);
  if (A <= DENOM_EPS) return NO_HITS;
  const f = sub(boundary.a, support.center);
  const B = 2 * dot(f, d0);
  const C = dot(f, f) - support.radius * support.radius;
  const disc = B * B - 4 * A * C;
  if (disc < -DISC_NEG) return NO_HITS;
  const root = Math.sqrt(Math.max(disc, 0));
  const us = [(-B - root) / (2 * A), (-B + root) / (2 * A)];
  const p0: Point = [boundary.a[0] + us[0]! * d0[0], boundary.a[1] + us[0]! * d0[1]];
  const p1: Point = [boundary.a[0] + us[1]! * d0[0], boundary.a[1] + us[1]! * d0[1]];
  const tangent = distance(p0, p1) <= TANGENT_SEP;
  const hits: Hit[] = [];
  for (const [u, point] of [
    [us[0]!, p0] as const,
    [us[1]!, p1] as const,
  ]) {
    if (u < -U_TOL || u > 1 + U_TOL) continue;
    const delta = arcForwardOffset(support, point);
    if (delta !== null) hits.push({ point, distance: support.radius * delta, boundaryId: boundary.id, tangent });
  }
  return { hits, overlapForward: false };
}

function arcVsArc(support: ArcSupport, boundary: Extract<BoundaryCurve, { kind: 'arc' }>): BoundaryHits {
  const arc = boundary.arc;
  const cc = sub(arc.center, support.center);
  const dd = Math.hypot(cc[0], cc[1]);
  const rA = support.radius;
  const rB = arc.radius;
  if (dd <= COLLINEAR_DIST && Math.abs(rA - rB) <= COLLINEAR_DIST) {
    // Co-circular: any forward extension runs along the boundary — a degenerate overlap.
    return { hits: [], overlapForward: true };
  }
  if (dd < DENOM_EPS) return NO_HITS; // concentric, different radii
  if (dd > rA + rB + TANGENT_SEP || dd < Math.abs(rA - rB) - TANGENT_SEP) return NO_HITS;
  const a = (rA * rA - rB * rB + dd * dd) / (2 * dd);
  const hSq = rA * rA - a * a;
  const h = Math.sqrt(Math.max(hSq, 0));
  const mx = support.center[0] + (a * cc[0]) / dd;
  const my = support.center[1] + (a * cc[1]) / dd;
  const ox = (-cc[1] / dd) * h;
  const oy = (cc[0] / dd) * h;
  const p0: Point = [mx + ox, my + oy];
  const p1: Point = [mx - ox, my - oy];
  const tangent = distance(p0, p1) <= TANGENT_SEP;
  const hits: Hit[] = [];
  for (const point of tangent ? [p0] : [p0, p1]) {
    if (!onBoundaryArc(arc, point)) continue;
    const delta = arcForwardOffset(support, point);
    if (delta !== null) hits.push({ point, distance: support.radius * delta, boundaryId: boundary.id, tangent });
  }
  return { hits, overlapForward: false };
}

function intersectSupport(support: Support, boundary: BoundaryCurve): BoundaryHits {
  if (support.kind === 'line') {
    return boundary.kind === 'line' ? lineVsLine(support, boundary) : lineVsArc(support, boundary);
  }
  return boundary.kind === 'line' ? arcVsLine(support, boundary) : arcVsArc(support, boundary);
}

const EXTENSION_ARC_SAMPLES = 24;

/** The sampled polyline of the added extension from the endpoint to the hit point. */
function sampleExtension(support: Support, hit: Point): Point[] {
  if (support.kind === 'line') return [support.origin, hit];
  const delta = arcForwardOffset(support, hit) ?? 0;
  const points: Point[] = [];
  for (let i = 0; i <= EXTENSION_ARC_SAMPLES; i++) {
    const angle = support.startAngle + support.sigma * ((delta * i) / EXTENSION_ARC_SAMPLES);
    points.push([support.center[0] + support.radius * Math.cos(angle), support.center[1] + support.radius * Math.sin(angle)]);
  }
  return points;
}

/** Plans an extend of `target` at the given plane-local cursor point. Pure — never mutates. */
export function computeExtend(sketch: SketchFeature, target: ResolvedCurve, cursor: Point): ExtendResult {
  const ends = endpointsOf(target);
  const dStart = distance(cursor, ends.start);
  const dEnd = distance(cursor, ends.end);
  if (Math.abs(dStart - dEnd) <= ENDPOINT_TIE_TOL) {
    return reject('ambiguous', 'Hover nearer one endpoint to choose which end to extend.');
  }
  const movedEnd: 'start' | 'end' = dStart < dEnd ? 'start' : 'end';
  const support = buildSupport(target, movedEnd);

  const boundaries = resolveBoundaries(sketch, target.id);
  const hits: Hit[] = [];
  let overlapForward = false;
  let farHitExists = false;
  for (const boundary of boundaries) {
    const result = intersectSupport(support, boundary);
    if (result.overlapForward) overlapForward = true;
    for (const hit of result.hits) {
      if (hit.distance > EXTEND_MAX_DISTANCE) farHitExists = true;
      else hits.push(hit);
    }
  }

  if (overlapForward) return reject('overlap', 'The extension runs along an existing curve.');
  if (hits.length === 0) {
    if (farHitExists) return reject('effectively-infinite', 'No boundary within reach in that direction.');
    return reject('no-forward-hit', 'No curve ahead of this endpoint to extend to.');
  }

  hits.sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.boundaryId < b.boundaryId ? -1 : 1));
  const best = hits[0]!;
  if (best.tangent) return reject('tangent', 'The extension only grazes that curve.');

  return {
    ok: true,
    plan: {
      target,
      movedEnd,
      endpoint: support.origin,
      hitPoint: best.point,
      boundaryId: best.boundaryId,
      extensionPolyline: sampleExtension(support, best.point),
    },
  };
}

// --- Applying the plan ----------------------------------------------------------

/** A materialised extend edit plus the ids of constraints it had to remove. */
export interface ExtendEdit extends SketchEdit {
  readonly removedConstraintIds: readonly string[];
}

/** Materialises an {@link ExtendPlan} into new entity/constraint arrays and the constraints it removed. */
export function applyExtend(sketch: SketchFeature, plan: ExtendPlan, createId: () => string): ExtendEdit {
  return plan.target.kind === 'line'
    ? applyLineExtend(sketch, plan, plan.target, createId)
    : applyArcExtend(sketch, plan, plan.target);
}

function applyLineExtend(
  sketch: SketchFeature,
  plan: ExtendPlan,
  target: Extract<ResolvedCurve, { kind: 'line' }>,
  createId: () => string,
): ExtendEdit {
  const movedPointId = plan.movedEnd === 'start' ? target.startId : target.endId;
  const fixedPointId = plan.movedEnd === 'start' ? target.endId : target.startId;
  const p = plan.hitPoint;

  // Fuse onto an existing point at the boundary (closing a loop) or create a fresh one.
  const existing = findExistingPointId(sketch, p);
  const newPoints: SketchEntity[] = [];
  let newMovedId: string;
  if (existing && existing !== fixedPointId && existing !== movedPointId) {
    newMovedId = existing;
  } else {
    newMovedId = createId();
    newPoints.push({ id: newMovedId, kind: 'point', x: p[0], y: p[1], construction: target.construction });
  }

  const newLine: SketchEntity = {
    id: target.id,
    kind: 'line',
    startId: plan.movedEnd === 'start' ? newMovedId : fixedPointId,
    endId: plan.movedEnd === 'start' ? fixedPointId : newMovedId,
    construction: target.construction,
  };

  let entities: SketchEntity[] = sketch.entities.filter((entity) => entity.id !== target.id);
  entities = [...entities, ...newPoints, newLine];

  // Drop the old moved endpoint only if nothing references it any more (never a shared corner).
  const referenced = referencedPointIds(entities);
  const removedPointIds = new Set<string>();
  if (!referenced.has(movedPointId)) {
    entities = entities.filter((entity) => entity.id !== movedPointId);
    removedPointIds.add(movedPointId);
  }

  const kept: SketchConstraint[] = [];
  const removedConstraintIds: string[] = [];
  for (const constraint of sketch.constraints) {
    if (constraintPointRefs(constraint).some((ref) => removedPointIds.has(ref))) {
      removedConstraintIds.push(constraint.id);
      continue;
    }
    kept.push(constraint);
  }

  return { entities, constraints: kept, removedConstraintIds };
}

function applyArcExtend(
  sketch: SketchFeature,
  plan: ExtendPlan,
  target: Extract<ResolvedCurve, { kind: 'arc' }>,
): ExtendEdit {
  const arc = target.arc;
  const hitAngle = Math.atan2(plan.hitPoint[1] - arc.center[1], plan.hitPoint[0] - arc.center[0]);
  const entity: SketchEntity = {
    id: target.id,
    kind: 'arc',
    centerId: target.centerId,
    radius: arc.radius,
    startAngle: plan.movedEnd === 'start' ? hitAngle : arc.startAngle,
    endAngle: plan.movedEnd === 'end' ? hitAngle : arc.endAngle,
    direction: target.direction,
    construction: target.construction,
  };
  const entities = [...sketch.entities.filter((e) => e.id !== target.id), entity];
  // Arcs reference only their preserved centre, so no constraint can break.
  return { entities, constraints: [...sketch.constraints], removedConstraintIds: [] };
}
