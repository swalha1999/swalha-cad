import { describe, expect, it } from 'vitest';
import { cross, dot, length, subtract, type Vec3 } from '../math/vec3.js';
import { buildFaceFrame, orthonormalBasisFromNormal } from './face-frame.js';
import { modelPointToSketch, sketchPointToModel } from './plane.js';

const NORMALS: { label: string; normal: Vec3 }[] = [
  { label: '+X', normal: [1, 0, 0] },
  { label: '-X', normal: [-1, 0, 0] },
  { label: '+Y', normal: [0, 1, 0] },
  { label: '-Y', normal: [0, -1, 0] },
  { label: '+Z', normal: [0, 0, 1] },
  { label: '-Z', normal: [0, 0, -1] },
  { label: 'diagonal', normal: [1, 1, 1] },
  { label: 'skew', normal: [0.3, -0.8, 0.5] },
];

function approxVec(a: Vec3, b: Vec3, tol = 1e-9): void {
  expect(length(subtract(a, b))).toBeLessThan(tol);
}

describe('orthonormalBasisFromNormal', () => {
  it.each(NORMALS)('produces a right-handed orthonormal basis for $label', ({ normal }) => {
    const { xAxis, yAxis } = orthonormalBasisFromNormal(normal);
    const frame = buildFaceFrame([0, 0, 0], normal);

    // Unit length.
    expect(length(xAxis)).toBeCloseTo(1, 9);
    expect(length(yAxis)).toBeCloseTo(1, 9);
    // Mutually orthogonal and both perpendicular to the normal.
    expect(dot(xAxis, yAxis)).toBeCloseTo(0, 9);
    expect(dot(xAxis, frame.normal)).toBeCloseTo(0, 9);
    expect(dot(yAxis, frame.normal)).toBeCloseTo(0, 9);
    // Right-handed: cross(xAxis, yAxis) === unit normal.
    approxVec(cross(xAxis, yAxis), frame.normal);
  });

  it('is a pure function of the normal (deterministic across calls)', () => {
    const a = orthonormalBasisFromNormal([0.3, -0.8, 0.5]);
    const b = orthonormalBasisFromNormal([0.3, -0.8, 0.5]);
    expect(a).toEqual(b);
  });

  it('is invariant to the normal magnitude (uses the direction only)', () => {
    const unit = orthonormalBasisFromNormal([0, 0, 1]);
    const scaled = orthonormalBasisFromNormal([0, 0, 7]);
    approxVec(unit.xAxis, scaled.xAxis);
    approxVec(unit.yAxis, scaled.yAxis);
  });
});

describe('buildFaceFrame', () => {
  it('normalizes the normal and preserves the origin', () => {
    const frame = buildFaceFrame([10, -4, 2], [0, 0, 5]);
    expect(frame.origin).toEqual([10, -4, 2]);
    approxVec(frame.normal, [0, 0, 1]);
    expect(length(frame.normal)).toBeCloseTo(1, 9);
  });

  it.each(NORMALS)('round-trips plane-local coordinates through the $label frame', ({ normal }) => {
    const frame = buildFaceFrame([12, 5, -7], normal);
    for (const p of [
      [0, 0],
      [3.5, -2.25],
      [-8.1, 4.4],
    ] as const) {
      const model = sketchPointToModel(frame, p);
      const back = modelPointToSketch(frame, model);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });

  it('places the sketch origin exactly at the face origin', () => {
    const frame = buildFaceFrame([12, 5, -7], [0, 1, 0]);
    approxVec(sketchPointToModel(frame, [0, 0]), [12, 5, -7]);
  });
});
