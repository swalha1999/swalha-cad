import { circumcircle } from './shapes.js';
import type { Vec2 } from './plane.js';

/**
 * Pure plane-local math for the Onshape-style arc and slot creation tools. Every
 * function works in the sketch's own 2D frame (millimetres, y up) and returns
 * `null` for a degenerate, collinear, or zero-radius input so callers reject it
 * visibly without mutating the document. Arcs are described the same way they are
 * stored (see the document `arc` entity): a center, a radius, a start and end
 * angle, and a sweep direction — the endpoints are always derived, never stored.
 * Kept side-effect free and deterministic so the web tools, previews, overlay,
 * and unit tests share one authoritative definition.
 */

/** Sweep direction of an arc from its start angle to its end angle. */
export type ArcDirection = 'ccw' | 'cw';

/** An arc expressed exactly as the document stores it: center, radius, angles, direction. */
export interface ArcGeometry {
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly direction: ArcDirection;
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle into [0, 2π). */
function wrap(angle: number): number {
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

function angleOf(v: Vec2): number {
  return Math.atan2(v[1], v[0]);
}

/** The two endpoints of an arc, derived from its center, radius, and angles. */
export function arcEndpoints(arc: ArcGeometry): { start: Vec2; end: Vec2 } {
  const { center, radius, startAngle, endAngle } = arc;
  return {
    start: [center[0] + radius * Math.cos(startAngle), center[1] + radius * Math.sin(startAngle)],
    end: [center[0] + radius * Math.cos(endAngle), center[1] + radius * Math.sin(endAngle)],
  };
}

/**
 * Signed total sweep (radians) of an arc: positive counter-clockwise, negative
 * clockwise. Coincident start/end angles denote a full turn (±2π), matching how
 * the document stores a full-circle arc. Exported so topology and extrusion can
 * size an arc's tessellation and detect a zero-sweep or full-circle degeneracy
 * from the same authoritative definition the sampler uses.
 */
export function signedArcSweep(arc: ArcGeometry): number {
  if (arc.direction === 'ccw') {
    const delta = wrap(arc.endAngle - arc.startAngle);
    return delta === 0 ? TWO_PI : delta;
  }
  const delta = wrap(arc.startAngle - arc.endAngle);
  return -(delta === 0 ? TWO_PI : delta);
}

/**
 * Samples an arc into `segments + 1` inclusive plane-local points from its start
 * endpoint to its end endpoint along the sweep direction. Deterministic — the
 * overlay draws the result as a polyline for both committed arcs and previews.
 */
export function sampleArc(arc: ArcGeometry, segments: number): Vec2[] {
  const count = Math.max(1, Math.floor(segments));
  const total = signedArcSweep(arc);
  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = arc.startAngle + (total * i) / count;
    points.push([arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)]);
  }
  return points;
}

/**
 * The unique arc through three ordered points (start → mid → end). The center and
 * radius come from the circumcircle; the direction is whichever sweep from start
 * to end passes through `mid`. Returns `null` for collinear or coincident points.
 */
export function threePointArc(start: Vec2, mid: Vec2, end: Vec2): ArcGeometry | null {
  const circle = circumcircle(start, mid, end);
  if (!circle) return null;
  const center = circle.center;
  const startAngle = angleOf(sub(start, center));
  const midAngle = angleOf(sub(mid, center));
  const endAngle = angleOf(sub(end, center));
  const ccwToEnd = wrap(endAngle - startAngle);
  const ccwToMid = wrap(midAngle - startAngle);
  // `mid` lies on the counter-clockwise path from start to end when its offset is
  // strictly inside that sweep; otherwise the arc must run clockwise.
  const direction: ArcDirection = ccwToMid > 0 && ccwToMid < ccwToEnd ? 'ccw' : 'cw';
  return { center, radius: circle.radius, startAngle, endAngle, direction };
}

/**
 * A center-point arc: `center` fixes the circle, `start` sets the radius and start
 * angle, and `through` picks the end ray and the sweep side (the minor arc toward
 * `through`). The end endpoint sits on the start radius along the through ray, not
 * at `through` itself. Returns `null` for a zero radius or a zero-sweep through ray.
 */
export function centerPointArc(center: Vec2, start: Vec2, through: Vec2): ArcGeometry | null {
  const startVec = sub(start, center);
  const radius = Math.hypot(startVec[0], startVec[1]);
  if (radius === 0) return null;
  const throughVec = sub(through, center);
  if (throughVec[0] === 0 && throughVec[1] === 0) return null;
  const startAngle = angleOf(startVec);
  const endAngle = angleOf(throughVec);
  if (startAngle === endAngle) return null;
  const cross = startVec[0] * throughVec[1] - startVec[1] * throughVec[0];
  const direction: ArcDirection = cross >= 0 ? 'ccw' : 'cw';
  return { center, radius, startAngle, endAngle, direction };
}

/**
 * A tangent-continuation arc: it leaves `start` travelling along `tangent` and
 * ends at `end`. The center lies on the normal to `tangent` at `start`, its
 * distance solved so the circle also passes through `end`. Returns `null` when
 * `tangent` or the span is zero, or when `end` lies along the tangent line (the
 * arc would be an infinite-radius straight line).
 */
export function tangentArc(start: Vec2, tangent: Vec2, end: Vec2): ArcGeometry | null {
  const tLen = Math.hypot(tangent[0], tangent[1]);
  if (tLen === 0) return null;
  const t: Vec2 = [tangent[0] / tLen, tangent[1] / tLen];
  const w = sub(end, start);
  if (w[0] === 0 && w[1] === 0) return null;
  // Left-hand normal of the tangent; the center is start + d·n for signed d.
  const n: Vec2 = [-t[1], t[0]];
  const denom = dot(n, w);
  if (denom === 0) return null;
  const d = dot(w, w) / (2 * denom);
  const radius = Math.abs(d);
  if (radius === 0) return null;
  const center: Vec2 = [start[0] + d * n[0], start[1] + d * n[1]];
  const startAngle = angleOf(sub(start, center));
  const endAngle = angleOf(sub(end, center));
  // Counter-clockwise velocity at the start endpoint; the arc runs ccw when that
  // aligns with the desired travel direction, clockwise otherwise.
  const radial = sub(start, center);
  const velCcw: Vec2 = [-radial[1], radial[0]];
  const direction: ArcDirection = dot(velCcw, t) >= 0 ? 'ccw' : 'cw';
  return { center, radius, startAngle, endAngle, direction };
}

/** The four tangent points where a slot's side lines meet its end caps. */
export interface SlotTangentPoints {
  readonly aLeft: Vec2;
  readonly aRight: Vec2;
  readonly bLeft: Vec2;
  readonly bRight: Vec2;
}

/** A straight slot: two parallel side lines and two outward-bulging semicircular caps. */
export interface StraightSlot {
  readonly centerA: Vec2;
  readonly centerB: Vec2;
  readonly radius: number;
  readonly tangentPoints: SlotTangentPoints;
  readonly lines: readonly { readonly a: Vec2; readonly b: Vec2 }[];
  readonly arcs: readonly ArcGeometry[];
}

/** A semicircular cap from `from` to `to` about `center`, sweeping so its bulge points along `outward`. */
function capArc(center: Vec2, from: Vec2, to: Vec2, outward: Vec2): ArcGeometry {
  const startAngle = angleOf(sub(from, center));
  const endAngle = angleOf(sub(to, center));
  const ccwDelta = wrap(endAngle - startAngle);
  const ccwMid = startAngle + ccwDelta / 2;
  const midDir: Vec2 = [Math.cos(ccwMid), Math.sin(ccwMid)];
  const radius = Math.hypot(from[0] - center[0], from[1] - center[1]);
  const direction: ArcDirection = dot(midDir, outward) >= 0 ? 'ccw' : 'cw';
  return { center, radius, startAngle, endAngle, direction };
}

/**
 * A straight slot between two center points, offset by `radius`: two parallel side
 * lines tangent to both caps, plus a semicircular cap at each center bulging away
 * from the other. Returns `null` for coincident centers or a non-positive radius.
 */
export function straightSlot(centerA: Vec2, centerB: Vec2, radius: number): StraightSlot | null {
  if (!(radius > 0)) return null;
  const axis = sub(centerB, centerA);
  const length = Math.hypot(axis[0], axis[1]);
  if (length === 0) return null;
  const u: Vec2 = [axis[0] / length, axis[1] / length];
  const n: Vec2 = [-u[1], u[0]];
  const offset = (base: Vec2, sign: number): Vec2 => [base[0] + sign * radius * n[0], base[1] + sign * radius * n[1]];
  const aLeft = offset(centerA, 1);
  const aRight = offset(centerA, -1);
  const bLeft = offset(centerB, 1);
  const bRight = offset(centerB, -1);
  const negU: Vec2 = [-u[0], -u[1]];
  return {
    centerA,
    centerB,
    radius,
    tangentPoints: { aLeft, aRight, bLeft, bRight },
    lines: [
      { a: aLeft, b: bLeft },
      { a: aRight, b: bRight },
    ],
    arcs: [capArc(centerA, aLeft, aRight, negU), capArc(centerB, bLeft, bRight, u)],
  };
}
