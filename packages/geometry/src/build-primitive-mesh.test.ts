import type { Primitive } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { buildPrimitiveMesh } from './build-primitive-mesh.js';
import { computeMeshBounds } from './mesh-validation.js';

describe('buildPrimitiveMesh', () => {
  it('dispatches a box primitive to a box mesh matching its bounds', () => {
    const primitive: Primitive = { kind: 'box', width: 2, height: 4, depth: 6 };
    const bounds = computeMeshBounds(buildPrimitiveMesh(primitive));
    expect(bounds.min).toEqual([-1, -2, -3]);
    expect(bounds.max).toEqual([1, 2, 3]);
  });

  it('dispatches a cylinder primitive to a cylinder mesh matching its bounds', () => {
    const primitive: Primitive = { kind: 'cylinder', radius: 2, height: 10, segments: 12 };
    const bounds = computeMeshBounds(buildPrimitiveMesh(primitive));
    expect(bounds.min[1]).toBeCloseTo(-5);
    expect(bounds.max[1]).toBeCloseTo(5);
  });

  it('dispatches an lBracket primitive to an L-bracket mesh matching its bounds', () => {
    const primitive: Primitive = { kind: 'lBracket', width: 10, height: 8, depth: 6, thickness: 3 };
    const bounds = computeMeshBounds(buildPrimitiveMesh(primitive));
    expect(bounds.min).toEqual([-5, -4, -3]);
    expect(bounds.max).toEqual([5, 4, 3]);
  });

  it('throws for an unknown primitive kind', () => {
    const primitive = { kind: 'sphere' } as unknown as Primitive;
    expect(() => buildPrimitiveMesh(primitive)).toThrow();
  });
});
