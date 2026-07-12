import { signedArcSweep, type ArcGeometry } from './arc.js';
import type { Vec2 } from './plane.js';

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

/** One edge of a closed loop, in sketch-local 2D coordinates, tagged with its originating line entity id. */
export interface LoopSegment {
  readonly lineId: string;
  readonly a: Vec2;
  readonly b: Vec2;
}

/** A pair of non-adjacent loop segments found to cross or overlap. */
export interface SelfIntersection {
  readonly lineIdA: string;
  readonly lineIdB: string;
}

function sign(value: number): -1 | 0 | 1 {
  if (value > EPSILON) return 1;
  if (value < -EPSILON) return -1;
  return 0;
}

function cross2(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

/** True if `r`, already known to be collinear with segment `p`-`q`, lies within its bounding box. */
function withinBounds(p: Vec2, q: Vec2, r: Vec2): boolean {
  return (
    Math.min(p[0], q[0]) - EPSILON <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + EPSILON &&
    Math.min(p[1], q[1]) - EPSILON <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + EPSILON
  );
}

/**
 * True if closed segments p1-p2 and p3-p4 cross or touch anywhere, including
 * a shared endpoint, a T-junction touch, or collinear overlap. Standard
 * orientation-based segment intersection test with an epsilon tolerance for
 * "collinear" so floating-point sketch coordinates behave predictably.
 */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = sign(cross2(p3, p4, p1));
  const d2 = sign(cross2(p3, p4, p2));
  const d3 = sign(cross2(p1, p2, p3));
  const d4 = sign(cross2(p1, p2, p4));

  if (d1 !== 0 && d2 !== 0 && d1 !== d2 && d3 !== 0 && d4 !== 0 && d3 !== d4) {
    return true;
  }
  if (d1 === 0 && withinBounds(p3, p4, p1)) return true;
  if (d2 === 0 && withinBounds(p3, p4, p2)) return true;
  if (d3 === 0 && withinBounds(p1, p2, p3)) return true;
  if (d4 === 0 && withinBounds(p1, p2, p4)) return true;
  return false;
}

/**
 * Checks all non-adjacent segment pairs of a closed loop for crossings or
 * overlaps. `segments[i]` and `segments[i + 1]` (with wraparound) are
 * adjacent — they share a loop vertex by construction — and are always
 * skipped, since touching there is expected rather than a self-intersection.
 */
export function findLoopSelfIntersections(segments: readonly LoopSegment[]): SelfIntersection[] {
  const n = segments.length;
  const found: SelfIntersection[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (isAdjacent) continue;
      const segA = segments[i]!;
      const segB = segments[j]!;
      if (segmentsIntersect(segA.a, segA.b, segB.a, segB.b)) {
        found.push({ lineIdA: segA.lineId, lineIdB: segB.lineId });
      }
    }
  }
  return found;
}

/** Wraps an angle into [0, 2π). */
function wrap(angle: number): number {
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/**
 * True if the point (given by its angle `phi` about the arc centre) lies on the
 * arc's sweep from `startAngle` toward `endAngle`, within an angular slack of
 * `angTol`. Direction-aware: a clockwise arc covers the complementary side of
 * the circle from a counter-clockwise one between the same angles.
 */
function angleOnArc(arc: ArcGeometry, phi: number, angTol: number): boolean {
  const sweep = signedArcSweep(arc);
  const magnitude = Math.abs(sweep);
  const offset = sweep >= 0 ? wrap(phi - arc.startAngle) : wrap(arc.startAngle - phi);
  // On the sweep if within [0, magnitude]; the wrap can place a near-start point
  // just below 2π, so accept that band too.
  return offset <= magnitude + angTol || offset >= TWO_PI - angTol;
}

/** True if `point` lies on `arc` (assumed already on the arc's circle) within tolerance. */
function pointOnArc(arc: ArcGeometry, point: Vec2, tolerance: number): boolean {
  const phi = Math.atan2(point[1] - arc.center[1], point[0] - arc.center[0]);
  const angTol = arc.radius > 0 ? tolerance / arc.radius : tolerance;
  return angleOnArc(arc, phi, angTol);
}

function dedupePoints(points: readonly Vec2[], tolerance: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) <= tolerance && Math.abs(q[1] - p[1]) <= tolerance)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * The single point where two closed segments `p1`-`p2` and `p3`-`p4` cross,
 * including a touch at a shared endpoint or a T-junction, or `null` when they do
 * not meet at exactly one point. Parallel and collinear pairs (zero cross
 * product) return `null` — a collinear overlap has no single crossing point and
 * is handled as a degenerate case by callers. The `tolerance` slackens the
 * within-segment test at each end so an endpoint that lands exactly on the other
 * segment still counts. This is the point-valued companion to
 * {@link segmentsIntersect}, used by sketch Trim/Split to locate the boundaries
 * that divide a target line.
 */
export function lineLineIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, tolerance = EPSILON): Vec2 | null {
  const rx = p2[0] - p1[0];
  const ry = p2[1] - p1[1];
  const sx = p4[0] - p3[0];
  const sy = p4[1] - p3[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) <= EPSILON) return null; // parallel or collinear: no single crossing
  const qpx = p3[0] - p1[0];
  const qpy = p3[1] - p1[1];
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null;
  return [p1[0] + t * rx, p1[1] + t * ry];
}

/**
 * Points where the closed segment `a`-`b` meets the given arc. Solves the
 * segment/circle quadratic, keeps the roots inside the segment, and retains only
 * those whose position also falls within the arc's angular sweep. A shared
 * endpoint counts as an intersection (callers skip loop-adjacent pairs).
 */
export function lineArcIntersections(a: Vec2, b: Vec2, arc: ArcGeometry, tolerance = EPSILON): Vec2[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - arc.center[0];
  const fy = a[1] - arc.center[1];
  const A = dx * dx + dy * dy;
  if (A <= tolerance * tolerance) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - arc.radius * arc.radius;
  const disc = B * B - 4 * A * C;
  if (disc < -tolerance) return [];
  const root = Math.sqrt(Math.max(disc, 0));
  const candidates: Vec2[] = [];
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t < -tolerance || t > 1 + tolerance) continue;
    const point: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    if (pointOnArc(arc, point, tolerance)) candidates.push(point);
  }
  return dedupePoints(candidates, Math.max(tolerance, 1e-9));
}

/**
 * Points where two arcs meet. For two distinct circles this is the standard
 * circle/circle construction filtered to the points on both sweeps. When the
 * arcs lie on the same circle (concentric, equal radius) it instead reports a
 * representative point if their sweeps overlap on more than a shared endpoint,
 * so co-circular overlaps are flagged rather than missed.
 */
export function arcArcIntersections(arcA: ArcGeometry, arcB: ArcGeometry, tolerance = EPSILON): Vec2[] {
  const cx = arcB.center[0] - arcA.center[0];
  const cy = arcB.center[1] - arcA.center[1];
  const d = Math.hypot(cx, cy);
  const rA = arcA.radius;
  const rB = arcB.radius;

  if (d <= tolerance && Math.abs(rA - rB) <= tolerance) {
    // Same circle: sample midpoints of A's sweep and its endpoints; report any
    // that also fall on B's sweep — an overlap beyond a single touching endpoint.
    const sweep = signedArcSweep(arcA);
    const overlaps: Vec2[] = [];
    for (const frac of [0.25, 0.5, 0.75]) {
      const angle = arcA.startAngle + sweep * frac;
      const point: Vec2 = [arcA.center[0] + rA * Math.cos(angle), arcA.center[1] + rA * Math.sin(angle)];
      if (pointOnArc(arcB, point, tolerance)) overlaps.push(point);
    }
    return dedupePoints(overlaps, Math.max(tolerance, 1e-9));
  }

  if (d < tolerance) return []; // concentric, different radii
  if (d > rA + rB + tolerance || d < Math.abs(rA - rB) - tolerance) return [];

  const a = (rA * rA - rB * rB + d * d) / (2 * d);
  const hSq = rA * rA - a * a;
  const h = Math.sqrt(Math.max(hSq, 0));
  const mx = arcA.center[0] + (a * cx) / d;
  const my = arcA.center[1] + (a * cy) / d;
  const ox = (-cy / d) * h;
  const oy = (cx / d) * h;
  const candidates: Vec2[] = h <= tolerance ? [[mx, my]] : [[mx + ox, my + oy], [mx - ox, my - oy]];
  const onBoth = candidates.filter((p) => pointOnArc(arcA, p, tolerance) && pointOnArc(arcB, p, tolerance));
  return dedupePoints(onBoth, Math.max(tolerance, 1e-9));
}

/** One edge of a closed loop that may be a straight line or a circular arc, in sketch-local coordinates. */
export type CurveLoopSegment =
  | { readonly id: string; readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly id: string; readonly kind: 'arc'; readonly a: Vec2; readonly b: Vec2; readonly arc: ArcGeometry };

/** True if two loop curves (line and/or arc) meet anywhere — a crossing, tangency, overlap, or shared endpoint. */
export function curveSegmentsIntersect(segA: CurveLoopSegment, segB: CurveLoopSegment): boolean {
  if (segA.kind === 'line' && segB.kind === 'line') {
    return segmentsIntersect(segA.a, segA.b, segB.a, segB.b);
  }
  if (segA.kind === 'line' && segB.kind === 'arc') {
    return lineArcIntersections(segA.a, segA.b, segB.arc).length > 0;
  }
  if (segA.kind === 'arc' && segB.kind === 'line') {
    return lineArcIntersections(segB.a, segB.b, segA.arc).length > 0;
  }
  if (segA.kind === 'arc' && segB.kind === 'arc') {
    return arcArcIntersections(segA.arc, segB.arc).length > 0;
  }
  return false;
}

/**
 * Checks every non-adjacent curve pair of a closed loop for crossings, tangencies,
 * or overlaps, handling any mix of line and arc edges. As with the line-only
 * variant, `segments[i]` and `segments[i + 1]` (with wraparound) share a loop
 * vertex by construction and are skipped — a two-edge loop (a line closed by an
 * arc, or two arcs) is therefore never flagged for touching at its two shared
 * endpoints.
 */
export function findCurveLoopIntersections(segments: readonly CurveLoopSegment[]): SelfIntersection[] {
  const n = segments.length;
  const found: SelfIntersection[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (isAdjacent) continue;
      const segA = segments[i]!;
      const segB = segments[j]!;
      if (curveSegmentsIntersect(segA, segB)) {
        found.push({ lineIdA: segA.id, lineIdB: segB.id });
      }
    }
  }
  return found;
}
