import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../math/vec3.js';
import { add, cross, dot, length, scale } from '../math/vec3.js';
import type { PlaneFrame, SketchPlane, Vec2 } from './plane.js';
import { getPlaneFrame, modelPointToSketch, modelVectorToSketch, sketchPointToModel, sketchVectorToModel } from './plane.js';

function expectVec3CloseTo(actual: Vec3, expected: Vec3, precision = 9) {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

function expectVec2CloseTo(actual: Vec2, expected: Vec2, precision = 9) {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
}

const PLANES: readonly SketchPlane[] = ['XY', 'XZ', 'YZ'];

describe('getPlaneFrame: basis orthogonality and unit length', () => {
  it.each(PLANES)('%s has unit-length xAxis, yAxis, and normal', (plane) => {
    const frame = getPlaneFrame(plane);
    expect(length(frame.xAxis)).toBeCloseTo(1, 10);
    expect(length(frame.yAxis)).toBeCloseTo(1, 10);
    expect(length(frame.normal)).toBeCloseTo(1, 10);
  });

  it.each(PLANES)('%s has mutually orthogonal xAxis, yAxis, and normal', (plane) => {
    const frame = getPlaneFrame(plane);
    expect(dot(frame.xAxis, frame.yAxis)).toBeCloseTo(0, 10);
    expect(dot(frame.xAxis, frame.normal)).toBeCloseTo(0, 10);
    expect(dot(frame.yAxis, frame.normal)).toBeCloseTo(0, 10);
  });

  it.each(PLANES)('%s origin is the model origin', (plane) => {
    expectVec3CloseTo(getPlaneFrame(plane).origin, [0, 0, 0]);
  });
});

describe('getPlaneFrame: right-handed orientation and normal direction', () => {
  it.each(PLANES)('%s normal equals cross(xAxis, yAxis)', (plane) => {
    const frame = getPlaneFrame(plane);
    expectVec3CloseTo(frame.normal, cross(frame.xAxis, frame.yAxis));
  });

  it('XY basis is +X, +Y with +Z normal', () => {
    const frame = getPlaneFrame('XY');
    expectVec3CloseTo(frame.xAxis, [1, 0, 0]);
    expectVec3CloseTo(frame.yAxis, [0, 1, 0]);
    expectVec3CloseTo(frame.normal, [0, 0, 1]);
  });

  it('XZ basis is +X, +Z with -Y normal', () => {
    const frame = getPlaneFrame('XZ');
    expectVec3CloseTo(frame.xAxis, [1, 0, 0]);
    expectVec3CloseTo(frame.yAxis, [0, 0, 1]);
    expectVec3CloseTo(frame.normal, [0, -1, 0]);
  });

  it('YZ basis is +Y, +Z with +X normal', () => {
    const frame = getPlaneFrame('YZ');
    expectVec3CloseTo(frame.xAxis, [0, 1, 0]);
    expectVec3CloseTo(frame.yAxis, [0, 0, 1]);
    expectVec3CloseTo(frame.normal, [1, 0, 0]);
  });

  it('throws for an unknown plane name', () => {
    expect(() => getPlaneFrame('ZZ' as SketchPlane)).toThrow(/unknown sketch plane/i);
  });
});

describe('sketchPointToModel: known coordinate mappings', () => {
  it('maps XY sketch coordinates straight across, with zero Z', () => {
    expectVec3CloseTo(sketchPointToModel(getPlaneFrame('XY'), [2, 3]), [2, 3, 0]);
  });

  it('maps XZ sketch coordinates to X and Z, with zero Y', () => {
    expectVec3CloseTo(sketchPointToModel(getPlaneFrame('XZ'), [2, 3]), [2, 0, 3]);
  });

  it('maps YZ sketch coordinates to Y and Z, with zero X', () => {
    expectVec3CloseTo(sketchPointToModel(getPlaneFrame('YZ'), [2, 3]), [0, 2, 3]);
  });

  it('throws for non-finite sketch point coordinates', () => {
    expect(() => sketchPointToModel(getPlaneFrame('XY'), [NaN, 0])).toThrow(/finite/i);
    expect(() => sketchPointToModel(getPlaneFrame('XY'), [0, Infinity])).toThrow(/finite/i);
    expect(() => sketchPointToModel(getPlaneFrame('XY'), [-Infinity, 0])).toThrow(/finite/i);
  });
});

describe('modelPointToSketch: arbitrary round trips and plane offset/projection', () => {
  it.each(PLANES)('%s round-trips an arbitrary sketch point through model space', (plane) => {
    const frame = getPlaneFrame(plane);
    const original: Vec2 = [4.5, -7.25];
    expectVec2CloseTo(modelPointToSketch(frame, sketchPointToModel(frame, original)), original);
  });

  it.each(PLANES)('%s projects a point offset along the normal, discarding the offset', (plane) => {
    const frame = getPlaneFrame(plane);
    const onPlane: Vec2 = [3, -2];
    const modelPoint = sketchPointToModel(frame, onPlane);
    const offsetPoint = add(modelPoint, scale(frame.normal, 10));
    expectVec2CloseTo(modelPointToSketch(frame, offsetPoint), onPlane);
  });

  it('throws for non-finite model point coordinates', () => {
    expect(() => modelPointToSketch(getPlaneFrame('XY'), [NaN, 0, 0])).toThrow(/finite/i);
    expect(() => modelPointToSketch(getPlaneFrame('XY'), [0, 0, Infinity])).toThrow(/finite/i);
  });
});

describe('sketchVectorToModel and modelVectorToSketch: round trips', () => {
  it.each(PLANES)('%s round-trips an arbitrary sketch vector through model space', (plane) => {
    const frame = getPlaneFrame(plane);
    const original: Vec2 = [1.5, -6];
    expectVec2CloseTo(modelVectorToSketch(frame, sketchVectorToModel(frame, original)), original);
  });

  it('throws for non-finite sketch vector coordinates', () => {
    expect(() => sketchVectorToModel(getPlaneFrame('XY'), [NaN, 0])).toThrow(/finite/i);
  });

  it('throws for non-finite model vector coordinates', () => {
    expect(() => modelVectorToSketch(getPlaneFrame('XY'), [0, NaN, 0])).toThrow(/finite/i);
  });
});

describe('point-versus-vector semantics', () => {
  const offsetFrame: PlaneFrame = { origin: [10, 20, 30], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };

  it('a point picks up the frame origin; a vector with the same sketch coordinates does not', () => {
    const sketchCoord: Vec2 = [2, 3];
    expectVec3CloseTo(sketchPointToModel(offsetFrame, sketchCoord), [12, 23, 30]);
    expectVec3CloseTo(sketchVectorToModel(offsetFrame, sketchCoord), [2, 3, 0]);
  });

  it('a model point at the frame origin maps to sketch (0, 0); the same model coordinates as a vector do not', () => {
    expectVec2CloseTo(modelPointToSketch(offsetFrame, offsetFrame.origin), [0, 0]);
    const vectorResult = modelVectorToSketch(offsetFrame, offsetFrame.origin);
    expect(Math.abs(vectorResult[0]) + Math.abs(vectorResult[1])).toBeGreaterThan(0);
  });
});
