import { describe, expect, it } from 'vitest';
import type { ArcGeometry } from './arc.js';
import { arcEndpoints } from './arc.js';
import {
  ARC_CHORD_TOLERANCE,
  MAX_ARC_SEGMENTS,
  MIN_ARC_SEGMENTS,
  arcMidpoint,
  arcSegmentCount,
  pointsClose,
  sampleArcEdge,
} from './curves.js';
import type { Vec2 } from './plane.js';

/** A counter-clockwise semicircle of radius 5 centred at the origin, from (5,0) to (-5,0). */
function semicircle(): ArcGeometry {
  return { center: [0, 0], radius: 5, startAngle: 0, endAngle: Math.PI, direction: 'ccw' };
}

describe('pointsClose', () => {
  it('treats coordinates within the endpoint tolerance as the same vertex', () => {
    expect(pointsClose([1, 2], [1 + 1e-9, 2 - 1e-9])).toBe(true);
  });

  it('separates coordinates beyond the endpoint tolerance', () => {
    expect(pointsClose([1, 2], [1.01, 2])).toBe(false);
  });
});

describe('arcSegmentCount', () => {
  it('never returns fewer than the minimum segment count', () => {
    expect(arcSegmentCount(1000, 0.001)).toBe(MIN_ARC_SEGMENTS);
  });

  it('clamps a fine tessellation to the maximum segment count', () => {
    // A huge radius forces a tiny per-chord angle, which would exceed the cap.
    expect(arcSegmentCount(1e9, Math.PI, ARC_CHORD_TOLERANCE)).toBe(MAX_ARC_SEGMENTS);
  });

  it('scales the count up with the swept angle for a fixed radius', () => {
    const quarter = arcSegmentCount(5, Math.PI / 2);
    const half = arcSegmentCount(5, Math.PI);
    expect(half).toBeGreaterThanOrEqual(quarter);
    expect(half).toBeGreaterThan(MIN_ARC_SEGMENTS);
  });

  it('keeps every chord within the requested tolerance', () => {
    const radius = 5;
    const sweep = Math.PI;
    const n = arcSegmentCount(radius, sweep, ARC_CHORD_TOLERANCE);
    const perChord = sweep / n;
    const sagitta = radius * (1 - Math.cos(perChord / 2));
    expect(sagitta).toBeLessThanOrEqual(ARC_CHORD_TOLERANCE + 1e-12);
  });

  it('is deterministic for identical inputs', () => {
    expect(arcSegmentCount(5, Math.PI)).toBe(arcSegmentCount(5, Math.PI));
  });
});

describe('sampleArcEdge', () => {
  it('samples forwards from the arc start when the traversal enters at the start endpoint', () => {
    const arc = semicircle();
    const { start, end } = arcEndpoints(arc);
    const pts = sampleArcEdge(arc, start);
    expect(pointsClose(pts[0]!, start)).toBe(true);
    expect(pointsClose(pts[pts.length - 1]!, end)).toBe(true);
  });

  it('samples backwards when the traversal enters at the arc end endpoint', () => {
    const arc = semicircle();
    const { start, end } = arcEndpoints(arc);
    const pts = sampleArcEdge(arc, end);
    expect(pointsClose(pts[0]!, end)).toBe(true);
    expect(pointsClose(pts[pts.length - 1]!, start)).toBe(true);
  });

  it('produces points that all lie on the arc circle', () => {
    const arc = semicircle();
    const { start } = arcEndpoints(arc);
    for (const p of sampleArcEdge(arc, start)) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(5, 9);
    }
  });
});

describe('arcMidpoint', () => {
  it('returns the point halfway along the arc sweep', () => {
    const mid: Vec2 = arcMidpoint(semicircle());
    // Halfway along a CCW semicircle from angle 0 to π is the top of the circle.
    expect(mid[0]).toBeCloseTo(0, 9);
    expect(mid[1]).toBeCloseTo(5, 9);
  });
});
