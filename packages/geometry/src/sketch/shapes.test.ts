import { describe, expect, it } from 'vitest';
import { centerRectangleCorners, circumcircle, regularPolygonVertices, threePointRectangleCorners } from './shapes.js';
import type { Vec2 } from './plane.js';

/** Convenience: assert two Vec2 are equal to a tolerance. */
function expectClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

describe('centerRectangleCorners', () => {
  it('produces four corners symmetric about the center, clicked corner first', () => {
    const corners = centerRectangleCorners([0, 0], [4, 3]);
    expect(corners).not.toBeNull();
    expect(corners).toEqual([
      [4, 3],
      [-4, 3],
      [-4, -3],
      [4, -3],
    ]);
  });

  it('handles a center away from the origin', () => {
    const corners = centerRectangleCorners([10, 5], [13, 9]);
    expect(corners).toEqual([
      [13, 9],
      [7, 9],
      [7, 1],
      [13, 1],
    ]);
  });

  it('rejects a corner sharing the center x (zero width)', () => {
    expect(centerRectangleCorners([2, 2], [2, 8])).toBeNull();
  });

  it('rejects a corner sharing the center y (zero height)', () => {
    expect(centerRectangleCorners([2, 2], [8, 2])).toBeNull();
  });
});

describe('threePointRectangleCorners', () => {
  it('defines the first edge then extends perpendicular to the third point', () => {
    // First edge along +x from (0,0) to (10,0); third point at height 4.
    const corners = threePointRectangleCorners([0, 0], [10, 0], [3, 4]);
    expect(corners).not.toBeNull();
    expectClose(corners![0], [0, 0]);
    expectClose(corners![1], [10, 0]);
    expectClose(corners![2], [10, 4]);
    expectClose(corners![3], [0, 4]);
  });

  it('supports an angled first edge with the width strictly perpendicular', () => {
    // First edge along +y; third point to the left gives negative signed width.
    const corners = threePointRectangleCorners([0, 0], [0, 10], [-5, 7]);
    expect(corners).not.toBeNull();
    expectClose(corners![0], [0, 0]);
    expectClose(corners![1], [0, 10]);
    expectClose(corners![2], [-5, 10]);
    expectClose(corners![3], [-5, 0]);
  });

  it('rejects a zero-length first edge', () => {
    expect(threePointRectangleCorners([2, 2], [2, 2], [5, 5])).toBeNull();
  });

  it('rejects a third point on the first edge line (zero width)', () => {
    expect(threePointRectangleCorners([0, 0], [10, 0], [4, 0])).toBeNull();
  });
});

describe('circumcircle', () => {
  it('finds the circle through three points on a known circle', () => {
    const result = circumcircle([1, 0], [0, 1], [-1, 0]);
    expect(result).not.toBeNull();
    expectClose(result!.center, [0, 0]);
    expect(result!.radius).toBeCloseTo(1, 9);
  });

  it('finds an off-origin circumcircle', () => {
    // Points on a circle of radius 5 centered at (2, 3).
    const result = circumcircle([7, 3], [2, 8], [-3, 3]);
    expect(result).not.toBeNull();
    expectClose(result!.center, [2, 3]);
    expect(result!.radius).toBeCloseTo(5, 9);
  });

  it('is order-independent (stable circumcenter)', () => {
    const a = circumcircle([7, 3], [2, 8], [-3, 3]);
    const b = circumcircle([-3, 3], [7, 3], [2, 8]);
    expectClose(a!.center, b!.center);
    expect(a!.radius).toBeCloseTo(b!.radius, 9);
  });

  it('rejects three collinear points', () => {
    expect(circumcircle([0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it('rejects near-collinear points scale-invariantly', () => {
    expect(circumcircle([0, 0], [1000, 0], [500, 1e-9])).toBeNull();
  });
});

describe('regularPolygonVertices', () => {
  it('creates n vertices on the circumcircle starting at the clicked vertex', () => {
    const verts = regularPolygonVertices([0, 0], [1, 0], 4);
    expect(verts).not.toBeNull();
    expect(verts).toHaveLength(4);
    expectClose(verts![0]!, [1, 0]);
    expectClose(verts![1]!, [0, 1]);
    expectClose(verts![2]!, [-1, 0]);
    expectClose(verts![3]!, [0, -1]);
  });

  it('defaults to a closed loop where every vertex is equidistant from the center', () => {
    const verts = regularPolygonVertices([2, 3], [2, 8], 6);
    expect(verts).toHaveLength(6);
    for (const v of verts!) {
      expect(Math.hypot(v[0] - 2, v[1] - 3)).toBeCloseTo(5, 9);
    }
  });

  it('rejects a zero-radius polygon', () => {
    expect(regularPolygonVertices([4, 4], [4, 4], 6)).toBeNull();
  });

  it('rejects fewer than three sides', () => {
    expect(regularPolygonVertices([0, 0], [1, 0], 2)).toBeNull();
  });

  it('rejects a non-integer side count', () => {
    expect(regularPolygonVertices([0, 0], [1, 0], 5.5)).toBeNull();
  });
});
