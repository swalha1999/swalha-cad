import type { Vec2 } from './plane.js';

/**
 * Pure plane-local geometry for the Onshape-style sketch creation tools. Every
 * function works in the sketch's own 2D frame (millimetres, y up) and returns
 * `null` for a degenerate or collinear input so callers can reject it visibly
 * without mutating the document. Kept side-effect free and deterministic so the
 * web tools, previews, and unit tests all share one authoritative definition.
 */

/** Four corners of a rectangle centred on `center` with one corner at `corner`. */
export type RectangleCorners = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * Corners of a center rectangle: the clicked `corner` and its three mirror
 * images across `center`, ordered as a closed loop with the clicked corner
 * first. Returns `null` when the corner shares an axis with the center (a
 * zero-width or zero-height rectangle).
 */
export function centerRectangleCorners(center: Vec2, corner: Vec2): RectangleCorners | null {
  const [cx, cy] = center;
  const [ex, ey] = corner;
  if (ex === cx || ey === cy) return null;
  const ox = 2 * cx - ex;
  const oy = 2 * cy - ey;
  return [
    [ex, ey],
    [ox, ey],
    [ox, oy],
    [ex, oy],
  ];
}

/**
 * Corners of a three-point rectangle: `a`→`b` is the first edge; `third`
 * projects onto the edge's perpendicular to set the (signed) width. Returns the
 * loop `[a, b, b+w·n, a+w·n]`, or `null` when the first edge is zero-length or
 * `third` lies on the edge line (zero width).
 */
export function threePointRectangleCorners(a: Vec2, b: Vec2, third: Vec2): RectangleCorners | null {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [tx, ty] = third;
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len === 0) return null;
  // Left-hand normal of the unit edge direction.
  const nx = -ey / len;
  const ny = ex / len;
  const width = (tx - bx) * nx + (ty - by) * ny;
  if (width === 0) return null;
  return [
    [ax, ay],
    [bx, by],
    [bx + width * nx, by + width * ny],
    [ax + width * nx, ay + width * ny],
  ];
}

/** A circle described by its centre and radius. */
export interface Circle {
  readonly center: Vec2;
  readonly radius: number;
}

/**
 * The unique circle passing through three points (its circumcircle). Returns
 * `null` for collinear or coincident points — detected scale-invariantly via the
 * normalized cross product so the threshold behaves the same at any coordinate
 * magnitude.
 */
export function circumcircle(a: Vec2, b: Vec2, c: Vec2): Circle | null {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [cx, cy] = c;

  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const cross = abx * acy - aby * acx;
  const scale = Math.hypot(abx, aby) * Math.hypot(acx, acy);
  if (scale === 0 || Math.abs(cross) <= 1e-9 * scale) return null;

  // Solve for the circumcenter as the intersection of the perpendicular
  // bisectors (standard determinant form); `d = 2·(signed area)` is non-zero here.
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const center: Vec2 = [ux, uy];
  const radius = Math.hypot(ax - ux, ay - uy);
  return { center, radius };
}

/**
 * Vertices of a regular polygon inscribed in the circle centred at `center`
 * with `vertex` as its first vertex (setting both circumradius and rotation).
 * The first entry is exactly `vertex`; the remaining `sides − 1` are spaced
 * counter-clockwise by `2π/sides`. Returns `null` for a zero radius or a side
 * count that is not an integer of at least three.
 */
export function regularPolygonVertices(center: Vec2, vertex: Vec2, sides: number): Vec2[] | null {
  if (!Number.isInteger(sides) || sides < 3) return null;
  const [cx, cy] = center;
  const dx = vertex[0] - cx;
  const dy = vertex[1] - cy;
  const radius = Math.hypot(dx, dy);
  if (radius === 0) return null;
  const start = Math.atan2(dy, dx);
  const vertices: Vec2[] = [[vertex[0], vertex[1]]];
  for (let k = 1; k < sides; k++) {
    const angle = start + (2 * Math.PI * k) / sides;
    vertices.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return vertices;
}
