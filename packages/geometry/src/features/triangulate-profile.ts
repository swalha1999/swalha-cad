import type { Vec2 } from '../sketch/plane.js';

/** A cap triangle as three indices into the polygon's vertex ring. */
export type ProfileTriangle = readonly [number, number, number];

/** Twice the signed area of triangle (a, b, c); positive when the three points wind counter-clockwise. */
function signedArea2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * True if `p` lies inside or on the boundary of triangle (a, b, c). Used to
 * reject an ear candidate that would swallow another vertex; treating boundary
 * hits as "inside" keeps ear clipping from emitting degenerate slivers.
 */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = signedArea2(p, a, b);
  const d2 = signedArea2(p, b, c);
  const d3 = signedArea2(p, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/**
 * Ear-clips a simple, non-self-intersecting polygon wound counter-clockwise
 * into a fan of triangles, each returned as indices into the input ring and
 * inheriting the polygon's counter-clockwise winding. The traversal always
 * clips the first valid ear in index order, so the output is fully determined
 * by the input vertex order (no dependence on floating-point tie-breaking).
 *
 * Convex profiles (the M2-supported rectangle and tessellated circle) always
 * expose an ear, so this terminates; a caller must pass a genuinely simple
 * loop, which profile detection (`sketch/profile.ts`) guarantees.
 */
export function triangulateSimplePolygon(points: readonly Vec2[]): ProfileTriangle[] {
  const n = points.length;
  if (n < 3) {
    throw new Error(`A profile needs at least 3 vertices to triangulate, got ${n}`);
  }

  const remaining = [...Array(n).keys()];
  const triangles: ProfileTriangle[] = [];

  const isConvex = (prev: number, current: number, next: number): boolean =>
    signedArea2(points[prev]!, points[current]!, points[next]!) > 0;

  const swallowsVertex = (prev: number, current: number, next: number): boolean => {
    for (const idx of remaining) {
      if (idx === prev || idx === current || idx === next) continue;
      if (pointInTriangle(points[idx]!, points[prev]!, points[current]!, points[next]!)) return true;
    }
    return false;
  };

  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const prev = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const current = remaining[i]!;
      const next = remaining[(i + 1) % remaining.length]!;
      if (isConvex(prev, current, next) && !swallowsVertex(prev, current, next)) {
        triangles.push([prev, current, next]);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) {
      throw new Error('Failed to triangulate profile: no ear found (profile is degenerate or self-intersecting)');
    }
  }

  triangles.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  return triangles;
}
