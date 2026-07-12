import { describe, expect, it } from 'vitest';
import {
  arcEndpoints,
  centerPointArc,
  sampleArc,
  straightSlot,
  tangentArc,
  threePointArc,
  type ArcGeometry,
} from './arc.js';
import type { Vec2 } from './plane.js';

const TWO_PI = Math.PI * 2;

/** Wraps an angle into [0, 2π) for stable comparison across the ±π branch cut. */
function wrap(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

function expectPointClose(actual: Vec2, expected: Vec2, precision = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
}

describe('threePointArc', () => {
  it('builds a counter-clockwise arc through three points on the upper semicircle', () => {
    const arc = threePointArc([1, 0], [0, 1], [-1, 0]);
    expect(arc).not.toBeNull();
    expectPointClose(arc!.center, [0, 0]);
    expect(arc!.radius).toBeCloseTo(1, 9);
    expect(arc!.direction).toBe('ccw');
    // Every defining point lies on the swept arc's circle.
    const { start, end } = arcEndpoints(arc!);
    expectPointClose(start, [1, 0]);
    expectPointClose(end, [-1, 0]);
  });

  it('builds a clockwise arc when the middle point is below the chord', () => {
    const arc = threePointArc([1, 0], [0, -1], [-1, 0]);
    expect(arc).not.toBeNull();
    expect(arc!.direction).toBe('cw');
  });

  it('returns null for three collinear points', () => {
    expect(threePointArc([0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it('returns null for coincident points', () => {
    expect(threePointArc([0, 0], [0, 0], [1, 1])).toBeNull();
  });
});

describe('centerPointArc', () => {
  it('sets the radius from the start point and sweeps counter-clockwise toward the through ray', () => {
    const arc = centerPointArc([0, 0], [2, 0], [0, 3]);
    expect(arc).not.toBeNull();
    expect(arc!.radius).toBeCloseTo(2, 9);
    expect(arc!.direction).toBe('ccw');
    expect(wrap(arc!.startAngle)).toBeCloseTo(0, 9);
    expect(wrap(arc!.endAngle)).toBeCloseTo(Math.PI / 2, 9);
    const { start, end } = arcEndpoints(arc!);
    expectPointClose(start, [2, 0]);
    // End sits on the through ray at the start radius, not at the through point itself.
    expectPointClose(end, [0, 2]);
  });

  it('sweeps clockwise when the through ray is on the clockwise side', () => {
    const arc = centerPointArc([0, 0], [2, 0], [0, -3]);
    expect(arc!.direction).toBe('cw');
  });

  it('returns null for a zero radius (start equal to center)', () => {
    expect(centerPointArc([0, 0], [0, 0], [1, 1])).toBeNull();
  });

  it('returns null when the through ray coincides with the start ray (zero sweep)', () => {
    expect(centerPointArc([0, 0], [2, 0], [5, 0])).toBeNull();
  });
});

describe('tangentArc', () => {
  it('continues tangent to the given direction and ends at the target point', () => {
    const arc = tangentArc([0, 0], [1, 0], [0, 2]);
    expect(arc).not.toBeNull();
    expectPointClose(arc!.center, [0, 1]);
    expect(arc!.radius).toBeCloseTo(1, 9);
    const { start, end } = arcEndpoints(arc!);
    expectPointClose(start, [0, 0]);
    expectPointClose(end, [0, 2]);
    // Leaving the start it should travel along +x (a left turn is counter-clockwise).
    const sampled = sampleArc(arc!, 64);
    const step: Vec2 = [sampled[1]![0] - sampled[0]![0], sampled[1]![1] - sampled[0]![1]];
    expect(step[0]).toBeGreaterThan(0);
  });

  it('turns the other way for the opposite tangent orientation', () => {
    const left = tangentArc([0, 0], [1, 0], [0, 2]);
    const right = tangentArc([0, 0], [1, 0], [0, -2]);
    expect(left!.direction).not.toBe(right!.direction);
  });

  it('returns null when the target lies along the tangent (infinite radius)', () => {
    expect(tangentArc([0, 0], [1, 0], [5, 0])).toBeNull();
  });

  it('returns null for a zero-length span or zero tangent', () => {
    expect(tangentArc([0, 0], [1, 0], [0, 0])).toBeNull();
    expect(tangentArc([0, 0], [0, 0], [1, 1])).toBeNull();
  });
});

describe('straightSlot', () => {
  it('produces two parallel lines and two outward-bulging semicircular caps', () => {
    const slot = straightSlot([0, 0], [10, 0], 2);
    expect(slot).not.toBeNull();
    expect(slot!.lines).toHaveLength(2);
    expect(slot!.arcs).toHaveLength(2);
    // Tangent points sit ±r perpendicular to the axis at each center.
    expectPointClose(slot!.tangentPoints.aLeft, [0, 2]);
    expectPointClose(slot!.tangentPoints.aRight, [0, -2]);
    expectPointClose(slot!.tangentPoints.bLeft, [10, 2]);
    expectPointClose(slot!.tangentPoints.bRight, [10, -2]);
    // Each side line is horizontal (parallel to the axis).
    for (const line of slot!.lines) {
      expect(line.a[1]).toBeCloseTo(line.b[1], 9);
    }
    // The A cap bulges toward -x (away from B); its swept midpoint is the far tip.
    const capA = slot!.arcs.find((arc) => Math.abs(arc.center[0]) < 1e-9)!;
    const mid = sampleArc(capA, 2)[1]!;
    expectPointClose(mid, [-2, 0]);
    // The B cap bulges toward +x.
    const capB = slot!.arcs.find((arc) => Math.abs(arc.center[0] - 10) < 1e-9)!;
    const midB = sampleArc(capB, 2)[1]!;
    expectPointClose(midB, [12, 0]);
  });

  it('orients caps correctly for a diagonal slot', () => {
    const slot = straightSlot([1, 1], [4, 5], 1);
    expect(slot).not.toBeNull();
    // Cap tips lie one radius beyond each center along the axis, on the outside.
    const axis: Vec2 = [4 - 1, 5 - 1];
    const len = Math.hypot(axis[0], axis[1]);
    const u: Vec2 = [axis[0] / len, axis[1] / len];
    const capA = slot!.arcs.find((arc) => Math.hypot(arc.center[0] - 1, arc.center[1] - 1) < 1e-9)!;
    const tipA = sampleArc(capA, 2)[1]!;
    expectPointClose(tipA, [1 - u[0], 1 - u[1]]);
  });

  it('returns null for coincident centers or a non-positive radius', () => {
    expect(straightSlot([0, 0], [0, 0], 2)).toBeNull();
    expect(straightSlot([0, 0], [10, 0], 0)).toBeNull();
    expect(straightSlot([0, 0], [10, 0], -1)).toBeNull();
  });
});

describe('sampleArc', () => {
  it('samples inclusive endpoints along the sweep', () => {
    const arc: ArcGeometry = { center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI, direction: 'ccw' };
    const pts = sampleArc(arc, 4);
    expect(pts).toHaveLength(5);
    expectPointClose(pts[0]!, [1, 0]);
    expectPointClose(pts[4]!, [-1, 0]);
    expectPointClose(pts[2]!, [0, 1]);
  });

  it('samples clockwise arcs through the lower half', () => {
    const arc: ArcGeometry = { center: [0, 0], radius: 1, startAngle: 0, endAngle: Math.PI, direction: 'cw' };
    const pts = sampleArc(arc, 4);
    expectPointClose(pts[2]!, [0, -1]);
  });
});
