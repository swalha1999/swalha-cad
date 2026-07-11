import { describe, expect, it } from 'vitest';
import { triangleCount, vertexCount } from '../mesh.js';
import { areIndicesInRange, areNormalsOutward, areNormalsUnitLength, computeMeshBounds, hasZeroAreaTriangles, isWindingOutward } from '../mesh-validation.js';
import { buildCylinderMesh } from './cylinder.js';

describe('buildCylinderMesh', () => {
  it('produces bounds matching radius and height for a segment count aligned to the axes', () => {
    const mesh = buildCylinderMesh(2, 10, 4);
    const bounds = computeMeshBounds(mesh);
    expect(bounds.min[0]).toBeCloseTo(-2);
    expect(bounds.max[0]).toBeCloseTo(2);
    expect(bounds.min[1]).toBeCloseTo(-5);
    expect(bounds.max[1]).toBeCloseTo(5);
    expect(bounds.min[2]).toBeCloseTo(-2);
    expect(bounds.max[2]).toBeCloseTo(2);
  });

  it('produces an exact height bound regardless of segment count', () => {
    const mesh = buildCylinderMesh(3, 8, 5);
    const bounds = computeMeshBounds(mesh);
    expect(bounds.min[1]).toBeCloseTo(-4);
    expect(bounds.max[1]).toBeCloseTo(4);
  });

  it('rejects non-positive radius or height', () => {
    expect(() => buildCylinderMesh(0, 10, 8)).toThrow();
    expect(() => buildCylinderMesh(-1, 10, 8)).toThrow();
    expect(() => buildCylinderMesh(2, 0, 8)).toThrow();
    expect(() => buildCylinderMesh(2, -10, 8)).toThrow();
  });

  it('rejects fewer than 3 segments', () => {
    expect(() => buildCylinderMesh(2, 10, 2)).toThrow();
    expect(() => buildCylinderMesh(2, 10, 0)).toThrow();
    expect(() => buildCylinderMesh(2, 10, -3)).toThrow();
  });

  it('rejects a non-integer segment count', () => {
    expect(() => buildCylinderMesh(2, 10, 3.5)).toThrow();
  });

  it('accepts the minimum segment count of 3', () => {
    expect(() => buildCylinderMesh(2, 10, 3)).not.toThrow();
  });

  it('generates complete side walls and caps: 4*segments vertices... plus centers, and 4*segments triangles', () => {
    const segments = 6;
    const mesh = buildCylinderMesh(2, 10, segments);
    expect(vertexCount(mesh)).toBe(4 * segments + 2);
    expect(triangleCount(mesh)).toBe(4 * segments);
  });

  it('closes the seam with every index referencing an existing vertex', () => {
    const mesh = buildCylinderMesh(2, 10, 7);
    expect(areIndicesInRange(mesh)).toBe(true);
  });

  it('winds every triangle outward-facing', () => {
    for (const segments of [3, 4, 5, 8, 32]) {
      const mesh = buildCylinderMesh(2, 10, segments);
      expect(isWindingOutward(mesh)).toBe(true);
    }
  });

  it('gives every vertex a unit-length normal pointing outward', () => {
    const mesh = buildCylinderMesh(2, 10, 12);
    expect(areNormalsUnitLength(mesh)).toBe(true);
    expect(areNormalsOutward(mesh)).toBe(true);
  });

  it('has no zero-area triangles', () => {
    for (const segments of [3, 4, 5, 8, 32]) {
      const mesh = buildCylinderMesh(2, 10, segments);
      expect(hasZeroAreaTriangles(mesh)).toBe(false);
    }
  });
});
