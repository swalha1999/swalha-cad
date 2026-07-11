import { describe, expect, it } from 'vitest';
import type { Vec3 } from './vec3.js';
import {
  fromRotationDeg,
  fromScale,
  fromTranslation,
  identity,
  invert,
  multiply,
  normalMatrix,
  transformDirection,
  transformPoint,
  transpose,
} from './mat4.js';

function expectVec3CloseTo(actual: Vec3, expected: Vec3, precision = 6) {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

describe('mat4', () => {
  it('identity leaves a point unchanged', () => {
    expectVec3CloseTo(transformPoint(identity(), [1, 2, 3]), [1, 2, 3]);
  });

  it('fromTranslation moves a point by the translation vector', () => {
    const m = fromTranslation([1, 2, 3]);
    expectVec3CloseTo(transformPoint(m, [0, 0, 0]), [1, 2, 3]);
  });

  it('fromTranslation does not affect direction vectors', () => {
    const m = fromTranslation([1, 2, 3]);
    expectVec3CloseTo(transformDirection(m, [1, 1, 1]), [1, 1, 1]);
  });

  it('fromScale scales a point per-axis', () => {
    const m = fromScale([2, 3, 4]);
    expectVec3CloseTo(transformPoint(m, [1, 1, 1]), [2, 3, 4]);
  });

  it('multiply(a, b) applies b first, then a — order is observable', () => {
    const translate = fromTranslation([1, 0, 0]);
    const scaleBy2 = fromScale([2, 2, 2]);

    // scale then translate: (1,1,1) -> (2,2,2) -> (3,2,2)
    const scaleThenTranslate = multiply(translate, scaleBy2);
    expectVec3CloseTo(transformPoint(scaleThenTranslate, [1, 1, 1]), [3, 2, 2]);

    // translate then scale: (1,1,1) -> (2,1,1) -> (4,2,2)
    const translateThenScale = multiply(scaleBy2, translate);
    expectVec3CloseTo(transformPoint(translateThenScale, [1, 1, 1]), [4, 2, 2]);
  });

  it('rotates +Y by 90deg about X to +Z', () => {
    const m = fromRotationDeg([90, 0, 0]);
    expectVec3CloseTo(transformPoint(m, [0, 1, 0]), [0, 0, 1]);
  });

  it('rotates +Z by 90deg about Y to +X', () => {
    const m = fromRotationDeg([0, 90, 0]);
    expectVec3CloseTo(transformPoint(m, [0, 0, 1]), [1, 0, 0]);
  });

  it('rotates +X by 90deg about Z to +Y', () => {
    const m = fromRotationDeg([0, 0, 90]);
    expectVec3CloseTo(transformPoint(m, [1, 0, 0]), [0, 1, 0]);
  });

  it('composes rotationDeg axes in X, then Y, then Z order (applied to the vector in that order)', () => {
    // Equivalent to Ry(90) * Rx(90) applied to v: rotate about X first, then Y.
    const m = fromRotationDeg([90, 90, 0]);
    expectVec3CloseTo(transformPoint(m, [0, 1, 0]), [1, 0, 0]);
  });

  it('rotation composition order is observable: Rx*Ry differs from Ry*Rx', () => {
    const rx = fromRotationDeg([90, 0, 0]);
    const ry = fromRotationDeg([0, 90, 0]);
    const v: Vec3 = [0, 0, 1];

    const rxThenRy = multiply(rx, ry);
    expectVec3CloseTo(transformPoint(rxThenRy, v), [1, 0, 0]);

    const ryThenRx = multiply(ry, rx);
    expectVec3CloseTo(transformPoint(ryThenRx, v), [0, -1, 0]);
  });

  it('transposes a matrix', () => {
    const m = fromTranslation([1, 2, 3]);
    const t = transpose(m);
    // translation column (12,13,14) becomes row 3 (indices 3,7,11)
    expect([t[3], t[7], t[11]]).toEqual([1, 2, 3]);
  });

  it('inverts a matrix such that m * invert(m) is the identity', () => {
    const m = multiply(fromTranslation([1, 2, 3]), multiply(fromRotationDeg([20, 40, 60]), fromScale([2, 3, 4])));
    const inv = invert(m);
    expect(inv).not.toBeNull();
    if (!inv) return;

    const roundTrip = multiply(m, inv);
    expectVec3CloseTo(transformPoint(roundTrip, [5, -7, 11]), [5, -7, 11]);
  });

  it('returns null when inverting a singular matrix', () => {
    const singular = fromScale([0, 1, 1]);
    expect(invert(singular)).toBeNull();
  });

  it('normalMatrix keeps normals perpendicular to tangents under non-uniform scale', () => {
    const m = fromScale([2, 1, 1]);
    const tangent: Vec3 = [1, 1, 0];
    const normalBefore: Vec3 = [1, -1, 0];
    expect(dotOf(tangent, normalBefore)).toBeCloseTo(0, 6);

    const transformedTangent = transformDirection(m, tangent);
    const naivelyTransformedNormal = transformDirection(m, normalBefore);
    // Naively scaling the normal like a regular vector breaks perpendicularity.
    expect(dotOf(transformedTangent, naivelyTransformedNormal)).not.toBeCloseTo(0, 6);

    const nMatrix = normalMatrix(m);
    expect(nMatrix).not.toBeNull();
    if (!nMatrix) return;

    const correctlyTransformedNormal = transformDirection(nMatrix, normalBefore);
    expect(dotOf(transformedTangent, correctlyTransformedNormal)).toBeCloseTo(0, 6);
  });

  function dotOf(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
});
