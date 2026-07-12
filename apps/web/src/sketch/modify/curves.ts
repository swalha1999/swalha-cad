import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import {
  arcArcIntersections,
  lineArcIntersections,
  lineLineIntersection,
  signedArcSweep,
  type ArcDirection,
  type ArcGeometry,
} from '@swalha-cad/geometry';

/**
 * Pure, sketch-entity-level curve helpers shared by the Trim and Split modify
 * tools. Everything here works in the sketch's own plane-local frame (millimetres,
 * y up) on plain `[x, y]` tuples so the trim/split reducers, their previews, and
 * their unit tests share one authoritative geometry definition without any React,
 * store, or SVG wiring. A sketch line's endpoints are stored point entities; an
 * arc's endpoints are derived from its centre/radius/angles, so a target curve is
 * always parameterised by a normalised `t ∈ [0, 1]` (a line's length fraction, or
 * an arc's fraction along its signed sweep from the start endpoint).
 */

export type Point = readonly [number, number];

/** Absolute coincidence tolerance (mm) for fusing a boundary onto an existing point (matches the geometry endpoint tolerance). */
export const POINT_MERGE_TOLERANCE = 1e-6;

/** Params within this fraction of a curve's ends are treated as the endpoint, not an interior boundary. */
export const PARAM_EPSILON = 1e-7;

/** Tolerance handed to the geometry intersection routines so off-grid float coordinates resolve robustly. */
const INTERSECT_TOLERANCE = 1e-6;

const TWO_PI = Math.PI * 2;

function wrap(angle: number): number {
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** A resolved sketch line or arc, ready for parameterised trimming/splitting. */
export type ResolvedCurve =
  | {
      readonly kind: 'line';
      readonly id: string;
      readonly construction: boolean;
      readonly a: Point;
      readonly b: Point;
      readonly startId: string;
      readonly endId: string;
    }
  | {
      readonly kind: 'arc';
      readonly id: string;
      readonly construction: boolean;
      readonly centerId: string;
      readonly arc: ArcGeometry;
      readonly direction: ArcDirection;
    };

/** A curve (line, arc, or full circle) that a trim/split target can be divided against. */
type BoundaryCurve =
  | { readonly id: string; readonly kind: 'line'; readonly a: Point; readonly b: Point }
  | { readonly id: string; readonly kind: 'arc'; readonly arc: ArcGeometry };

function pointCoords(sketch: SketchFeature): Map<string, Point> {
  const coords = new Map<string, Point>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') coords.set(entity.id, [entity.x, entity.y]);
  }
  return coords;
}

/** Full-circle arc geometry so a circle can act as a trimming boundary through the arc routines. */
function fullCircleArc(center: Point, radius: number): ArcGeometry {
  return { center, radius, startAngle: 0, endAngle: 0, direction: 'ccw' };
}

function arcGeometryOf(entity: Extract<SketchEntity, { kind: 'arc' }>, center: Point): ArcGeometry {
  return {
    center,
    radius: entity.radius,
    startAngle: entity.startAngle,
    endAngle: entity.endAngle,
    direction: entity.direction,
  };
}

/** Resolves a line or arc entity to a {@link ResolvedCurve}, or `null` when the id is missing/unsupported/dangling. */
export function resolveCurve(sketch: SketchFeature, id: string): ResolvedCurve | null {
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (!entity) return null;
  const coords = pointCoords(sketch);
  if (entity.kind === 'line') {
    const a = coords.get(entity.startId);
    const b = coords.get(entity.endId);
    if (!a || !b) return null;
    return { kind: 'line', id: entity.id, construction: entity.construction, a, b, startId: entity.startId, endId: entity.endId };
  }
  if (entity.kind === 'arc') {
    const center = coords.get(entity.centerId);
    if (!center) return null;
    return {
      kind: 'arc',
      id: entity.id,
      construction: entity.construction,
      centerId: entity.centerId,
      arc: arcGeometryOf(entity, center),
      direction: entity.direction,
    };
  }
  return null;
}

/** All lines and arcs other than `excludeId`, as boundary curves (circles included as full circles). */
function resolveBoundaries(sketch: SketchFeature, excludeId: string): BoundaryCurve[] {
  const coords = pointCoords(sketch);
  const boundaries: BoundaryCurve[] = [];
  for (const entity of sketch.entities) {
    if (entity.id === excludeId) continue;
    if (entity.kind === 'line') {
      const a = coords.get(entity.startId);
      const b = coords.get(entity.endId);
      if (a && b) boundaries.push({ id: entity.id, kind: 'line', a, b });
    } else if (entity.kind === 'circle') {
      const c = coords.get(entity.centerId);
      if (c) boundaries.push({ id: entity.id, kind: 'arc', arc: fullCircleArc(c, entity.radius) });
    } else if (entity.kind === 'arc') {
      const c = coords.get(entity.centerId);
      if (c) boundaries.push({ id: entity.id, kind: 'arc', arc: arcGeometryOf(entity, c) });
    }
  }
  return boundaries;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pointAtLineParam(a: Point, b: Point, t: number): Point {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export function pointAtArcParam(arc: ArcGeometry, t: number): Point {
  const angle = arc.startAngle + signedArcSweep(arc) * t;
  return [arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)];
}

/** The normalised position of an angle along an arc's sweep; may fall outside [0, 1] when off the sweep. */
function arcAngleParam(arc: ArcGeometry, phi: number): number {
  const sweep = signedArcSweep(arc);
  const magnitude = Math.abs(sweep);
  if (magnitude === 0) return 0;
  const offset = sweep >= 0 ? wrap(phi - arc.startAngle) : wrap(arc.startAngle - phi);
  return offset / magnitude;
}

/** The angle (radians) at a normalised param along an arc's sweep. */
export function arcParamAngle(arc: ArcGeometry, t: number): number {
  return arc.startAngle + signedArcSweep(arc) * t;
}

export interface Projection {
  /** Clamped normalised position of the nearest point on the curve. */
  readonly t: number;
  /** The nearest point on the curve. */
  readonly point: Point;
  /** Plane-local distance (mm) from the query point to the curve. */
  readonly distance: number;
}

function projectToLine(p: Point, a: Point, b: Point): Projection {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return { t: 0, point: a, distance: distance(p, a) };
  const raw = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  const t = Math.max(0, Math.min(1, raw));
  const point = pointAtLineParam(a, b, t);
  return { t, point, distance: distance(p, point) };
}

function projectToArc(p: Point, arc: ArcGeometry): Projection {
  const dx = p[0] - arc.center[0];
  const dy = p[1] - arc.center[1];
  const phi = Math.atan2(dy, dx);
  const t = arcAngleParam(arc, phi);
  if (t >= -PARAM_EPSILON && t <= 1 + PARAM_EPSILON) {
    const clamped = Math.max(0, Math.min(1, t));
    const foot = pointAtArcParam(arc, clamped);
    return { t: clamped, point: foot, distance: distance(p, foot) };
  }
  // Off the sweep: the nearest point is whichever endpoint is closer.
  const start = pointAtArcParam(arc, 0);
  const end = pointAtArcParam(arc, 1);
  const dStart = distance(p, start);
  const dEnd = distance(p, end);
  return dStart <= dEnd ? { t: 0, point: start, distance: dStart } : { t: 1, point: end, distance: dEnd };
}

/** Projects a query point onto a resolved curve, returning the nearest position, point, and distance. */
export function projectToCurve(curve: ResolvedCurve, p: Point): Projection {
  return curve.kind === 'line' ? projectToLine(p, curve.a, curve.b) : projectToArc(p, curve.arc);
}

/** The line/arc nearest to `p` within `maxDistance`, ties broken by id; `null` when none is close enough. */
export function pickCurve(sketch: SketchFeature, p: Point, maxDistance: number): ResolvedCurve | null {
  let best: { curve: ResolvedCurve; distance: number } | null = null;
  for (const entity of sketch.entities) {
    if (entity.kind !== 'line' && entity.kind !== 'arc') continue;
    const curve = resolveCurve(sketch, entity.id);
    if (!curve) continue;
    const d = projectToCurve(curve, p).distance;
    if (d > maxDistance) continue;
    if (best === null || d < best.distance || (d === best.distance && curve.id < best.curve.id)) {
      best = { curve, distance: d };
    }
  }
  return best?.curve ?? null;
}

/** Converts an intersection point (known to lie on the target) to its normalised param on that target. */
function paramOnTarget(target: ResolvedCurve, point: Point): number {
  return projectToCurve(target, point).t;
}

/** Raw intersection points of the target with one boundary curve. */
function boundaryIntersections(target: ResolvedCurve, boundary: BoundaryCurve): Point[] {
  if (target.kind === 'line') {
    if (boundary.kind === 'line') {
      const hit = lineLineIntersection(target.a, target.b, boundary.a, boundary.b, INTERSECT_TOLERANCE);
      return hit ? [hit] : [];
    }
    return lineArcIntersections(target.a, target.b, boundary.arc, INTERSECT_TOLERANCE);
  }
  // Arc target.
  if (boundary.kind === 'line') {
    return lineArcIntersections(boundary.a, boundary.b, target.arc, INTERSECT_TOLERANCE);
  }
  return arcArcIntersections(target.arc, boundary.arc, INTERSECT_TOLERANCE);
}

/**
 * The sorted, de-duplicated interior split params where a target curve meets every
 * other curve in the sketch (construction geometry included as a boundary).
 * Intersections at or beyond the target's own endpoints are excluded, so a shared
 * endpoint never counts as a usable trim boundary.
 */
export function targetSplitParams(sketch: SketchFeature, target: ResolvedCurve): number[] {
  const boundaries = resolveBoundaries(sketch, target.id);
  const params: number[] = [];
  for (const boundary of boundaries) {
    for (const point of boundaryIntersections(target, boundary)) {
      const t = paramOnTarget(target, point);
      if (t > PARAM_EPSILON && t < 1 - PARAM_EPSILON) params.push(t);
    }
  }
  params.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of params) {
    if (unique.length === 0 || t - unique[unique.length - 1]! > PARAM_EPSILON) unique.push(t);
  }
  return unique;
}

/** The coordinate at a normalised param along a resolved curve. */
export function curvePointAtParam(curve: ResolvedCurve, t: number): Point {
  return curve.kind === 'line' ? pointAtLineParam(curve.a, curve.b, t) : pointAtArcParam(curve.arc, t);
}
