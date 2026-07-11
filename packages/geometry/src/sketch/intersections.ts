import type { Vec2 } from './plane.js';

const EPSILON = 1e-9;

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
