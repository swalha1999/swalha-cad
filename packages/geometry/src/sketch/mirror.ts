import type { ArcDirection, ArcGeometry } from './arc.js';
import type { Vec2 } from './plane.js';

/**
 * Pure plane-local math for the Onshape-style sketch Mirror tool: reflect a point
 * or a circular arc across an infinite straight axis. Everything works in the
 * sketch's own 2D frame (millimetres, y up) on plain `[x, y]` tuples and is
 * side-effect free and deterministic, so the web mirror reducer, its live
 * preview, and the unit tests share one authoritative geometric definition.
 *
 * Reflection across a line is an orientation-reversing isometry: it preserves
 * every distance (so a circle keeps its radius and an arc keeps its sweep
 * magnitude) but flips handedness (so a counter-clockwise arc becomes clockwise
 * and vice versa). The axis is always treated as the *infinite* line through its
 * two endpoints, never the bounded segment.
 */

/** Squared length below which the axis is treated as zero-length (degenerate). */
const AXIS_EPSILON_SQ = 1e-18;

/**
 * Reflects `point` across the infinite line through `axisA`→`axisB`. Returns
 * `null` when the axis has effectively zero length (no defined direction to
 * mirror about).
 */
export function reflectPointAcrossLine(point: Vec2, axisA: Vec2, axisB: Vec2): Vec2 | null {
  const dx = axisB[0] - axisA[0];
  const dy = axisB[1] - axisA[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= AXIS_EPSILON_SQ) return null;
  const t = ((point[0] - axisA[0]) * dx + (point[1] - axisA[1]) * dy) / lenSq;
  const footX = axisA[0] + t * dx;
  const footY = axisA[1] + t * dy;
  return [2 * footX - point[0], 2 * footY - point[1]];
}

/**
 * Reflects an arc across the infinite line through `axisA`→`axisB`. The center is
 * reflected, the radius is preserved, and both endpoints are reflected and
 * re-expressed as angles about the new center; because reflection reverses
 * orientation the sweep direction is flipped, so the mirrored arc traces the exact
 * mirror image of the original with an identical sweep magnitude. Returns `null`
 * for a zero-length axis.
 */
export function reflectArcAcrossLine(arc: ArcGeometry, axisA: Vec2, axisB: Vec2): ArcGeometry | null {
  const center = reflectPointAcrossLine(arc.center, axisA, axisB);
  if (!center) return null;
  const startPoint: Vec2 = [
    arc.center[0] + arc.radius * Math.cos(arc.startAngle),
    arc.center[1] + arc.radius * Math.sin(arc.startAngle),
  ];
  const endPoint: Vec2 = [
    arc.center[0] + arc.radius * Math.cos(arc.endAngle),
    arc.center[1] + arc.radius * Math.sin(arc.endAngle),
  ];
  const rStart = reflectPointAcrossLine(startPoint, axisA, axisB)!;
  const rEnd = reflectPointAcrossLine(endPoint, axisA, axisB)!;
  const startAngle = Math.atan2(rStart[1] - center[1], rStart[0] - center[0]);
  const endAngle = Math.atan2(rEnd[1] - center[1], rEnd[0] - center[0]);
  const direction: ArcDirection = arc.direction === 'ccw' ? 'cw' : 'ccw';
  return { center, radius: arc.radius, startAngle, endAngle, direction };
}
