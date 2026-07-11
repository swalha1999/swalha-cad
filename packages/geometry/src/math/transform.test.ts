import { describe, expect, it } from 'vitest';
import type { Vec3 } from './vec3.js';
import { fromRotationDeg, identity, multiply, transformPoint } from './mat4.js';
import { composeTransformMatrix, composeWorldMatrix, transformNormalBy, transformPointBy } from './transform.js';
import type { Transform } from './transform.js';

function expectVec3CloseTo(actual: Vec3, expected: Vec3, precision = 6) {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

const IDENTITY_TRANSFORM: Transform = {
  translation: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
};

describe('composeTransformMatrix', () => {
  it('produces the identity matrix for an identity transform', () => {
    expectVec3CloseTo(transformPoint(composeTransformMatrix(IDENTITY_TRANSFORM), [1, 2, 3]), [1, 2, 3]);
  });

  it('composes scale, then rotation, then translation (T * R * S)', () => {
    const transform: Transform = {
      translation: [1, 0, 0],
      rotationDeg: [0, 0, 90],
      scale: [2, 1, 1],
    };

    // (1,0,0) -[scale]-> (2,0,0) -[rotate 90 about Z]-> (0,2,0) -[translate]-> (1,2,0)
    expectVec3CloseTo(transformPointBy(transform, [1, 0, 0]), [1, 2, 0]);
  });
});

describe('composeWorldMatrix', () => {
  it('applies the local transform first, then the parent transform', () => {
    const parent = fromRotationDeg([0, 0, 90]);
    const local = composeTransformMatrix({ translation: [1, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });

    const world = composeWorldMatrix(parent, local);

    // A child offset by (1,0,0) in local space sits at (0,1,0) once the
    // parent's 90deg rotation about Z is applied around the parent origin.
    expectVec3CloseTo(transformPoint(world, [0, 0, 0]), [0, 1, 0]);
  });

  it('is equivalent to multiply(parentWorld, local)', () => {
    const parent = fromRotationDeg([0, 0, 90]);
    const local = fromRotationDeg([90, 0, 0]);

    expect(composeWorldMatrix(parent, local)).toEqual(multiply(parent, local));
  });

  it('produces a different result than reversing the composition order', () => {
    const parent = fromRotationDeg([0, 0, 90]);
    const local = composeTransformMatrix({ translation: [1, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });

    const worldOrder = transformPoint(composeWorldMatrix(parent, local), [0, 0, 0]);
    const reversedOrder = transformPoint(composeWorldMatrix(local, parent), [0, 0, 0]);

    expect(worldOrder).not.toEqual(reversedOrder);
  });

  it('leaves a root entity unchanged when its parent is the identity', () => {
    const local = composeTransformMatrix({ translation: [3, 4, 5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    expectVec3CloseTo(transformPoint(composeWorldMatrix(identity(), local), [0, 0, 0]), [3, 4, 5]);
  });
});

describe('transformNormalBy', () => {
  it('leaves normals unchanged under a pure translation', () => {
    const transform: Transform = { translation: [5, 5, 5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    expectVec3CloseTo(transformNormalBy(transform, [0, 1, 0]), [0, 1, 0]);
  });

  it('keeps the normal perpendicular to its tangent under non-uniform scale', () => {
    const transform: Transform = { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [2, 1, 1] };
    const tangent: Vec3 = [1, 1, 0];
    const normal: Vec3 = [1, -1, 0];

    // Sanity check: normal is perpendicular to tangent before transforming.
    expect(tangent[0] * normal[0] + tangent[1] * normal[1] + tangent[2] * normal[2]).toBe(0);

    const transformedTangent = transformPointBy(
      { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: transform.scale },
      tangent,
    );
    const transformedNormal = transformNormalBy(transform, normal);

    const dot =
      transformedTangent[0] * transformedNormal[0] +
      transformedTangent[1] * transformedNormal[1] +
      transformedTangent[2] * transformedNormal[2];
    expect(dot).toBeCloseTo(0, 6);

    expectVec3CloseTo(transformedNormal, [0.4472135955, -0.894427191, 0]);
  });
});
