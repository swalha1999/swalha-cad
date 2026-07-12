import { arcEndpoints, sampleArc, signedArcSweep, type ArcGeometry } from './arc.js';
import type { Vec2 } from './plane.js';

/**
 * Shared curve helpers for topology, profile detection, and extrusion of sketches
 * that mix straight lines and circular arcs. Every value here is a pure function
 * of its inputs so the endpoint matching and arc tessellation are byte-identical
 * across the graph builder, the winding check, and the mesh generator.
 */

/**
 * Absolute tolerance (mm) for treating two sketch endpoints as the same vertex.
 * Arc endpoints are *derived* from a centre/radius/angles rather than stored as
 * shared point ids, so a line's endpoint and an adjacent arc's endpoint that are
 * meant to coincide differ only by floating-point round-off (~1e-15 for slot
 * geometry); this tolerance is the band within which such endpoints are fused.
 */
export const ENDPOINT_TOLERANCE = 1e-6;

/** Maximum chord deviation (mm) allowed when tessellating an arc into straight segments. */
export const ARC_CHORD_TOLERANCE = 0.05;
/** An arc always contributes at least this many chords, so a semicircle is never a single degenerate edge. */
export const MIN_ARC_SEGMENTS = 2;
/** Upper bound on chords per arc, so a near-flat (huge-radius) arc cannot explode the vertex count. */
export const MAX_ARC_SEGMENTS = 256;

/** True when two plane-local points coincide within `tolerance`. */
export function pointsClose(a: Vec2, b: Vec2, tolerance = ENDPOINT_TOLERANCE): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

/**
 * Number of straight chords used to approximate an arc of the given radius and
 * absolute sweep so no chord deviates from the true arc by more than
 * `tolerance` (the sagitta bound). A single chord may span at most
 * `2·acos(1 − tolerance/radius)` radians, so the count is `ceil(sweep / that)`,
 * clamped to `[MIN_ARC_SEGMENTS, MAX_ARC_SEGMENTS]`. Pure and deterministic: the
 * same (radius, sweep) always yields the same integer, which is what keeps
 * extrusion output byte-identical across runs.
 */
export function arcSegmentCount(radius: number, sweepAbs: number, tolerance = ARC_CHORD_TOLERANCE): number {
  if (!(radius > 0) || !(sweepAbs > 0)) return MIN_ARC_SEGMENTS;
  const ratio = Math.min(1, tolerance / radius);
  const maxAnglePerSegment = 2 * Math.acos(1 - ratio) || Math.PI;
  const count = Math.ceil(sweepAbs / maxAnglePerSegment);
  return Math.max(MIN_ARC_SEGMENTS, Math.min(MAX_ARC_SEGMENTS, count));
}

/**
 * Samples an arc into inclusive chord points running from `traversalStart` to the
 * arc's other endpoint, sized by {@link arcSegmentCount}. The stored arc always
 * samples from its own start endpoint along its sweep direction; when a loop
 * traverses the arc the other way (entering at the stored end endpoint) the
 * samples are reversed, so the returned polyline always begins at
 * `traversalStart`.
 */
export function sampleArcEdge(arc: ArcGeometry, traversalStart: Vec2, tolerance = ARC_CHORD_TOLERANCE): Vec2[] {
  const sweep = signedArcSweep(arc);
  const segments = arcSegmentCount(arc.radius, Math.abs(sweep), tolerance);

  // Uniform chord sampling alone generally misses axis extrema when an arc's
  // start angle is not aligned with the segment step. Include every cardinal
  // angle crossed by the sweep so generated bounds preserve the authored
  // circle/slot radius exactly while retaining the deterministic sagitta cap.
  const parameters = new Set<number>();
  for (let i = 0; i <= segments; i++) parameters.add(i / segments);
  const twoPi = Math.PI * 2;
  for (let cardinal = 0; cardinal < 4; cardinal++) {
    const base = cardinal * (Math.PI / 2);
    for (let turn = -2; turn <= 2; turn++) {
      const t = (base + turn * twoPi - arc.startAngle) / sweep;
      if (t > 1e-12 && t < 1 - 1e-12) parameters.add(t);
    }
  }

  const points = [...parameters]
    .sort((a, b) => a - b)
    .map((t): Vec2 => {
      const angle = arc.startAngle + sweep * t;
      return [arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)];
    });
  const forward = pointsClose(traversalStart, arcEndpoints(arc).start);
  return forward ? points : [...points].reverse();
}

/** The point halfway along an arc's sweep — a stable identity for detecting duplicate/reversed-duplicate arcs. */
export function arcMidpoint(arc: ArcGeometry): Vec2 {
  const [, mid] = sampleArc(arc, 2);
  return mid!;
}
