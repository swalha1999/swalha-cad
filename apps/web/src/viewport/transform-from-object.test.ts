import { describe, expect, it } from 'vitest';
import { MathUtils, Mesh } from 'three';
import { transformFromObject } from './transform-from-object.js';

describe('transformFromObject', () => {
  it('round-trips an identity transform', () => {
    const object = new Mesh();

    const transform = transformFromObject(object);

    expect(transform).toEqual({ translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('round-trips translation, rotation, and scale set the same way scene-sync applies them', () => {
    const object = new Mesh();
    object.position.set(12, -4, 7);
    const [rx, ry, rz] = [15, -30, 45];
    object.rotation.set(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz), 'ZYX');
    object.scale.set(2, 0.5, 1.25);

    const transform = transformFromObject(object);

    expect(transform.translation[0]).toBeCloseTo(12, 6);
    expect(transform.translation[1]).toBeCloseTo(-4, 6);
    expect(transform.translation[2]).toBeCloseTo(7, 6);
    expect(transform.rotationDeg[0]).toBeCloseTo(rx, 6);
    expect(transform.rotationDeg[1]).toBeCloseTo(ry, 6);
    expect(transform.rotationDeg[2]).toBeCloseTo(rz, 6);
    expect(transform.scale[0]).toBeCloseTo(2, 6);
    expect(transform.scale[1]).toBeCloseTo(0.5, 6);
    expect(transform.scale[2]).toBeCloseTo(1.25, 6);
  });
});
