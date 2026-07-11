import { describe, expect, it } from 'vitest';
import { triangleCount, vertexCount } from '../mesh.js';
import { areIndicesInRange, areNormalsOutward, areNormalsUnitLength, computeMeshBounds, hasZeroAreaTriangles, isWindingOutward } from '../mesh-validation.js';
import { buildBoxMesh } from './box.js';

describe('buildBoxMesh', () => {
  it('produces bounds matching width/height/depth, centered at the origin', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    const bounds = computeMeshBounds(mesh);
    expect(bounds.min).toEqual([-1, -2, -3]);
    expect(bounds.max).toEqual([1, 2, 3]);
  });

  it('produces 24 vertices (4 per face, hard-edged) and 12 triangles', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    expect(vertexCount(mesh)).toBe(24);
    expect(triangleCount(mesh)).toBe(12);
  });

  it('keeps every triangle index within the vertex range', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    expect(areIndicesInRange(mesh)).toBe(true);
  });

  it('winds every triangle outward-facing', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    expect(isWindingOutward(mesh)).toBe(true);
  });

  it('gives every vertex a unit-length normal pointing outward', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    expect(areNormalsUnitLength(mesh)).toBe(true);
    expect(areNormalsOutward(mesh)).toBe(true);
  });

  it('has no zero-area triangles', () => {
    const mesh = buildBoxMesh(2, 4, 6);
    expect(hasZeroAreaTriangles(mesh)).toBe(false);
  });

  it('handles non-cubic dimensions independently per axis', () => {
    const mesh = buildBoxMesh(1, 100, 0.5);
    const bounds = computeMeshBounds(mesh);
    expect(bounds.min).toEqual([-0.5, -50, -0.25]);
    expect(bounds.max).toEqual([0.5, 50, 0.25]);
    expect(hasZeroAreaTriangles(mesh)).toBe(false);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => buildBoxMesh(0, 4, 6)).toThrow();
    expect(() => buildBoxMesh(2, -4, 6)).toThrow();
    expect(() => buildBoxMesh(2, 4, 0)).toThrow();
  });
});
