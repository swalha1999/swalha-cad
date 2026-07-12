import { describe, expect, it } from 'vitest';
import { arcEndpoints, signedArcSweep } from './arc.js';
import { filletTwoLines, MAX_CORNER_ANGLE, type FilletLineInput } from './fillet.js';
import type { Vec2 } from './plane.js';

function line(a: Vec2, b: Vec2, pick: Vec2): FilletLineInput {
  return { a, b, pick };
}

function expectClose(actual: Vec2, expected: Vec2, tol = 1e-9): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  void tol;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe('filletTwoLines — canonical 90° corner', () => {
  const horizontal = line([0, 0], [100, 0], [50, 0]);
  const vertical = line([0, 0], [0, 100], [0, 50]);

  it('places tangent points at radius along each edge and centre on the bisector', () => {
    const result = filletTwoLines(horizontal, vertical, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { solution } = result;
    expectClose(solution.tangentA, [10, 0]);
    expectClose(solution.tangentB, [0, 10]);
    expectClose(solution.arc.center, [10, 10]);
    expect(solution.arc.radius).toBeCloseTo(10, 9);
    expectClose(solution.corner, [0, 0]);
  });

  it('produces an arc tangent to both lines (perpendicular radii, exact radius)', () => {
    const result = filletTwoLines(horizontal, vertical, 12.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { arc, tangentA, tangentB } = result.solution;
    expect(dist(arc.center, tangentA)).toBeCloseTo(arc.radius, 9);
    expect(dist(arc.center, tangentB)).toBeCloseTo(arc.radius, 9);
    // Radius to tangent point is perpendicular to the line direction.
    const radialA: Vec2 = [tangentA[0] - arc.center[0], tangentA[1] - arc.center[1]];
    expect(radialA[0] * 1 + radialA[1] * 0).toBeCloseTo(0, 9); // ⟂ +x
    const radialB: Vec2 = [tangentB[0] - arc.center[0], tangentB[1] - arc.center[1]];
    expect(radialB[0] * 0 + radialB[1] * 1).toBeCloseTo(0, 9); // ⟂ +y
  });

  it('sweeps the minor arc (π − φ) so the fillet rounds the corner', () => {
    const result = filletTwoLines(horizontal, vertical, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(signedArcSweep(result.solution.arc))).toBeCloseTo(Math.PI / 2, 9);
  });

  it('derives arc endpoints that coincide exactly with the stored tangent points (watertight)', () => {
    const result = filletTwoLines(horizontal, vertical, 8.3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ends = arcEndpoints(result.solution.arc);
    const near = (p: Vec2, q: Vec2) => dist(p, q) < 1e-9;
    const { tangentA, tangentB } = result.solution;
    expect(near(ends.start, tangentA) || near(ends.start, tangentB)).toBe(true);
    expect(near(ends.end, tangentA) || near(ends.end, tangentB)).toBe(true);
  });

  it('retains the far endpoint of each line', () => {
    const result = filletTwoLines(horizontal, vertical, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solution.retainedA).toBe('b');
    expect(result.solution.retainedB).toBe('b');
  });
});

describe('filletTwoLines — every quadrant of a corner at the origin', () => {
  const cases: { name: string; a: FilletLineInput; b: FilletLineInput; center: Vec2; tA: Vec2; tB: Vec2 }[] = [
    {
      name: 'first quadrant (+x, +y)',
      a: line([0, 0], [50, 0], [25, 0]),
      b: line([0, 0], [0, 50], [0, 25]),
      center: [10, 10],
      tA: [10, 0],
      tB: [0, 10],
    },
    {
      name: 'second quadrant (−x, +y)',
      a: line([0, 0], [-50, 0], [-25, 0]),
      b: line([0, 0], [0, 50], [0, 25]),
      center: [-10, 10],
      tA: [-10, 0],
      tB: [0, 10],
    },
    {
      name: 'third quadrant (−x, −y)',
      a: line([0, 0], [-50, 0], [-25, 0]),
      b: line([0, 0], [0, -50], [0, -25]),
      center: [-10, -10],
      tA: [-10, 0],
      tB: [0, -10],
    },
    {
      name: 'fourth quadrant (+x, −y)',
      a: line([0, 0], [50, 0], [25, 0]),
      b: line([0, 0], [0, -50], [0, -25]),
      center: [10, -10],
      tA: [10, 0],
      tB: [0, -10],
    },
  ];

  for (const testCase of cases) {
    it(`rounds the ${testCase.name}`, () => {
      const result = filletTwoLines(testCase.a, testCase.b, 10);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expectClose(result.solution.arc.center, testCase.center);
      expectClose(result.solution.tangentA, testCase.tA);
      expectClose(result.solution.tangentB, testCase.tB);
      // Whichever direction, the sweep magnitude is the 90° minor arc.
      expect(Math.abs(signedArcSweep(result.solution.arc))).toBeCloseTo(Math.PI / 2, 9);
    });
  }
});

describe('filletTwoLines — pick side selects the retained ray', () => {
  it('picks opposite rays of two crossing lines by pick position', () => {
    const horizontal = line([-50, 0], [100, 0], [50, 0]); // pick on +x ray
    const vertical = line([0, -50], [0, 100], [0, 50]); // pick on +y ray
    const result = filletTwoLines(horizontal, vertical, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectClose(result.solution.arc.center, [10, 10]);
    expect(result.solution.retainedA).toBe('b');
    expect(result.solution.retainedB).toBe('b');
  });

  it('rounds the negative-x / positive-y corner when the pick is on the −x ray', () => {
    const horizontal = line([-50, 0], [100, 0], [-25, 0]); // pick on −x ray
    const vertical = line([0, -50], [0, 100], [0, 50]); // pick on +y ray
    const result = filletTwoLines(horizontal, vertical, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectClose(result.solution.arc.center, [-10, 10]);
    expect(result.solution.retainedA).toBe('a'); // far −x endpoint
  });
});

describe('filletTwoLines — arbitrary non-grid corner (tangency holds under rotation)', () => {
  it('keeps both radii perpendicular and equal for a rotated, off-grid corner', () => {
    // Corner at (3.7, -2.1); edges at 200° and 71°.
    const corner: Vec2 = [3.7, -2.1];
    const dirA: Vec2 = [Math.cos(2.7), Math.sin(2.7)];
    const dirB: Vec2 = [Math.cos(1.24), Math.sin(1.24)];
    const a = line(corner, [corner[0] + 80 * dirA[0], corner[1] + 80 * dirA[1]], [corner[0] + 40 * dirA[0], corner[1] + 40 * dirA[1]]);
    const b = line(corner, [corner[0] + 80 * dirB[0], corner[1] + 80 * dirB[1]], [corner[0] + 40 * dirB[0], corner[1] + 40 * dirB[1]]);
    const result = filletTwoLines(a, b, 6.25);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { arc, tangentA, tangentB } = result.solution;
    expect(dist(arc.center, tangentA)).toBeCloseTo(6.25, 9);
    expect(dist(arc.center, tangentB)).toBeCloseTo(6.25, 9);
    // Tangent point lies on the line direction from the corner.
    const alongA = (tangentA[0] - corner[0]) * dirA[0] + (tangentA[1] - corner[1]) * dirA[1];
    expect(dist(tangentA, [corner[0] + alongA * dirA[0], corner[1] + alongA * dirA[1]])).toBeCloseTo(0, 9);
    // Radius ⟂ line direction at the tangent point.
    const radialA: Vec2 = [tangentA[0] - arc.center[0], tangentA[1] - arc.center[1]];
    expect(radialA[0] * dirA[0] + radialA[1] * dirA[1]).toBeCloseTo(0, 9);
  });
});

describe('filletTwoLines — rejections', () => {
  const horizontal = line([0, 0], [100, 0], [50, 0]);
  const vertical = line([0, 0], [0, 100], [0, 50]);

  it('rejects a non-finite, zero, or negative radius', () => {
    for (const r of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = filletTwoLines(horizontal, vertical, r);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('radius-invalid');
    }
  });

  it('rejects parallel lines (no unique corner)', () => {
    const upper = line([0, 10], [100, 10], [50, 10]);
    const result = filletTwoLines(horizontal, upper, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parallel');
  });

  it('rejects collinear lines', () => {
    const collinear = line([200, 0], [300, 0], [250, 0]);
    const result = filletTwoLines(horizontal, collinear, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parallel');
  });

  it('rejects a near-zero corner angle', () => {
    const nearlyCollinear = line([0, 0], [100, 0.001], [50, 0.0005]);
    const result = filletTwoLines(horizontal, nearlyCollinear, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('zero-angle');
  });

  it('rejects a near-straight (180°) corner', () => {
    // Both lines pass through the origin; retained rays point in nearly opposite directions.
    const a = line([-100, 0], [100, 0], [50, 0]); // retained +x
    const b = line([-100, -0.001], [100, 0.001], [-50, -0.0005]); // retained −x
    const result = filletTwoLines(a, b, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('straight-angle');
  });

  it('rejects a radius too large for the bounded retained segments', () => {
    const shortH = line([0, 0], [5, 0], [2.5, 0]);
    const shortV = line([0, 0], [0, 5], [0, 2.5]);
    const result = filletTwoLines(shortH, shortV, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('radius-too-large');
  });

  it('rejects a pick sitting on the corner (ambiguous side)', () => {
    const onCorner = line([0, 0], [100, 0], [0, 0]);
    const result = filletTwoLines(onCorner, vertical, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ambiguous');
  });
});

describe('filletTwoLines — boundary of the fit check', () => {
  it('accepts a radius whose tangent point lands just inside a segment', () => {
    // 90° corner, segment length 100, radius 99 → tangent at 99 < 100.
    const horizontal = line([0, 0], [100, 0], [50, 0]);
    const vertical = line([0, 0], [0, 100], [0, 50]);
    const result = filletTwoLines(horizontal, vertical, 99);
    expect(result.ok).toBe(true);
  });

  it('treats MAX_CORNER_ANGLE as a shared, exported threshold', () => {
    expect(MAX_CORNER_ANGLE).toBeLessThan(Math.PI);
    expect(MAX_CORNER_ANGLE).toBeGreaterThan(Math.PI - 1e-3);
  });
});
