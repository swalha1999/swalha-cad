import { describe, expect, it } from 'vitest';
import type { ArcGeometry, Vec2 } from '../index.js';
import { reflectArcAcrossLine, reflectPointAcrossLine, sampleArc, signedArcSweep } from '../index.js';

const HALF_PI = Math.PI / 2;

function close(a: Vec2, b: Vec2, tol = 1e-9): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
}

describe('reflectPointAcrossLine', () => {
  it('reflects across a horizontal axis by flipping y', () => {
    const r = reflectPointAcrossLine([3, 4], [0, 0], [10, 0])!;
    expect(close(r, [3, -4])).toBe(true);
  });

  it('reflects across a vertical axis by flipping x', () => {
    const r = reflectPointAcrossLine([3, 4], [0, 0], [0, 10])!;
    expect(close(r, [-3, 4])).toBe(true);
  });

  it('reflects across an offset horizontal axis (y = 5)', () => {
    const r = reflectPointAcrossLine([2, 8], [-1, 5], [7, 5])!;
    expect(close(r, [2, 2])).toBe(true);
  });

  it('reflects across a 45° axis by swapping coordinates', () => {
    const r = reflectPointAcrossLine([2, 0], [0, 0], [1, 1])!;
    expect(close(r, [0, 2])).toBe(true);
  });

  it('reflects across an arbitrary angled axis (isometry: distance to axis preserved)', () => {
    const a: Vec2 = [1, 2];
    const b: Vec2 = [5, 7];
    const p: Vec2 = [3, 9];
    const r = reflectPointAcrossLine(p, a, b)!;
    // Midpoint of p and r lies on the axis; the segment p→r is perpendicular to the axis.
    const mid: Vec2 = [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2];
    const axisDir: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const toMid: Vec2 = [mid[0] - a[0], mid[1] - a[1]];
    // mid on axis → cross(axisDir, toMid) ≈ 0
    expect(Math.abs(axisDir[0] * toMid[1] - axisDir[1] * toMid[0])).toBeLessThan(1e-9);
    // perpendicular → dot(axisDir, p→r) ≈ 0
    const pr: Vec2 = [r[0] - p[0], r[1] - p[1]];
    expect(Math.abs(axisDir[0] * pr[0] + axisDir[1] * pr[1])).toBeLessThan(1e-9);
  });

  it('is an involution (reflecting twice returns the original)', () => {
    const a: Vec2 = [-2, 1];
    const b: Vec2 = [4, 3];
    const p: Vec2 = [7, -5];
    const once = reflectPointAcrossLine(p, a, b)!;
    const twice = reflectPointAcrossLine(once, a, b)!;
    expect(close(twice, p)).toBe(true);
  });

  it('a point on the axis reflects to itself', () => {
    const r = reflectPointAcrossLine([5, 0], [0, 0], [10, 0])!;
    expect(close(r, [5, 0])).toBe(true);
  });

  it('returns null for a zero-length axis', () => {
    expect(reflectPointAcrossLine([1, 1], [2, 2], [2, 2])).toBeNull();
  });
});

describe('reflectArcAcrossLine', () => {
  it('reverses direction and mirrors a quarter arc across the x-axis', () => {
    const arc: ArcGeometry = { center: [0, 0], radius: 1, startAngle: 0, endAngle: HALF_PI, direction: 'ccw' };
    const m = reflectArcAcrossLine(arc, [0, 0], [1, 0])!;
    expect(m.direction).toBe('cw');
    expect(m.radius).toBe(1);
    expect(close(m.center, [0, 0])).toBe(true);
    // Start endpoint (1,0) maps to itself; end endpoint (0,1) maps to (0,-1) → angle -π/2.
    expect(Math.abs(m.startAngle - 0)).toBeLessThan(1e-9);
    expect(Math.abs(m.endAngle - -HALF_PI)).toBeLessThan(1e-9);
  });

  it('preserves the sweep magnitude under reflection', () => {
    const arc: ArcGeometry = { center: [2, 3], radius: 4, startAngle: 0.3, endAngle: 2.1, direction: 'ccw' };
    const m = reflectArcAcrossLine(arc, [-1, 2], [5, 9])!;
    expect(Math.abs(Math.abs(signedArcSweep(m)) - Math.abs(signedArcSweep(arc)))).toBeLessThan(1e-9);
  });

  it('mirrors the arc as a point set: every sampled point reflects onto the mirrored arc', () => {
    const arc: ArcGeometry = { center: [3, -2], radius: 5, startAngle: 0.5, endAngle: 2.4, direction: 'ccw' };
    const axisA: Vec2 = [0, 1];
    const axisB: Vec2 = [4, 3];
    const m = reflectArcAcrossLine(arc, axisA, axisB)!;
    const original = sampleArc(arc, 12);
    const mirrored = sampleArc(m, 12);
    for (let i = 0; i < original.length; i++) {
      const expected = reflectPointAcrossLine(original[i]!, axisA, axisB)!;
      // The mirrored arc, sampled start→end, corresponds index-for-index to the reflected original.
      expect(close(mirrored[i]!, expected, 1e-6)).toBe(true);
    }
  });

  it('flips a clockwise arc to counter-clockwise', () => {
    const arc: ArcGeometry = { center: [0, 0], radius: 2, startAngle: 1, endAngle: 0.2, direction: 'cw' };
    const m = reflectArcAcrossLine(arc, [0, 0], [0, 1])!;
    expect(m.direction).toBe('ccw');
  });

  it('returns null for a zero-length axis', () => {
    const arc: ArcGeometry = { center: [0, 0], radius: 1, startAngle: 0, endAngle: 1, direction: 'ccw' };
    expect(reflectArcAcrossLine(arc, [1, 1], [1, 1])).toBeNull();
  });
});
