import { describe, expect, it } from 'vitest';
import { triangleCount, vertexCount } from '../mesh.js';
import {
  areIndicesInRange,
  areNormalsOutward,
  areNormalsUnitLength,
  computeMeshBounds,
  hasZeroAreaTriangles,
  isWatertight,
  isWindingOutward,
} from '../mesh-validation.js';
import { buildLBracketMesh } from './l-bracket.js';

/** The L-bracket's kernel point: any point inside the corner block sees the whole concave boundary. */
function starCenter(width: number, height: number, thickness: number): [number, number, number] {
  return [-width / 2 + thickness / 2, -height / 2 + thickness / 2, 0];
}

describe('buildLBracketMesh', () => {
  it('produces outer bounds matching width/height/depth, centered at the origin', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    const bounds = computeMeshBounds(mesh);
    expect(bounds.min).toEqual([-5, -4, -3]);
    expect(bounds.max).toEqual([5, 4, 3]);
  });

  it('keeps the concave inner corner offset from the outer bounds by exactly the wall thickness', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    const positions = Array.from({ length: vertexCount(mesh) }, (_, v) => v)
      .map((v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!] as const);
    const hasInnerCorner = positions.some(([x, y]) => Math.abs(x - (-5 + 3)) < 1e-6 && Math.abs(y - (-4 + 3)) < 1e-6);
    expect(hasInnerCorner).toBe(true);
  });

  it('keeps every triangle index within the vertex range', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    expect(areIndicesInRange(mesh)).toBe(true);
  });

  it('has no zero-area triangles', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    expect(hasZeroAreaTriangles(mesh)).toBe(false);
  });

  it('is watertight: every undirected edge occurs in exactly two triangles', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    expect(isWatertight(mesh)).toBe(true);
  });

  it('stays watertight for non-square profiles and thin walls', () => {
    for (const [width, height, depth, thickness] of [
      [20, 12, 4, 2],
      [5, 5, 5, 1],
      [12, 30, 2, 6],
    ] as const) {
      const mesh = buildLBracketMesh(width, height, depth, thickness);
      expect(isWatertight(mesh)).toBe(true);
    }
  });

  it('winds every triangle outward-facing from a point inside the concave corner', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    expect(isWindingOutward(mesh, starCenter(10, 8, 3))).toBe(true);
  });

  it('gives every vertex a unit-length normal pointing outward from the concave corner', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    expect(areNormalsUnitLength(mesh)).toBe(true);
    expect(areNormalsOutward(mesh, starCenter(10, 8, 3))).toBe(true);
  });

  it('produces the expected vertex and triangle counts for the extruded concave hexagon', () => {
    const mesh = buildLBracketMesh(10, 8, 6, 3);
    // 6 profile vertices on the front cap + 6 on the back cap + 4 per side wall quad across 6 edges.
    expect(vertexCount(mesh)).toBe(6 + 6 + 6 * 4);
    // 4 fan triangles per cap + 2 triangles per side wall quad across 6 edges.
    expect(triangleCount(mesh)).toBe(4 + 4 + 6 * 2);
  });

  it('rejects non-positive width, height, or depth', () => {
    expect(() => buildLBracketMesh(0, 8, 6, 3)).toThrow();
    expect(() => buildLBracketMesh(10, -8, 6, 3)).toThrow();
    expect(() => buildLBracketMesh(10, 8, 0, 3)).toThrow();
  });

  it('rejects non-positive thickness', () => {
    expect(() => buildLBracketMesh(10, 8, 6, 0)).toThrow();
    expect(() => buildLBracketMesh(10, 8, 6, -1)).toThrow();
  });

  it('rejects thickness that is not strictly less than both width and height', () => {
    expect(() => buildLBracketMesh(10, 8, 6, 8)).toThrow();
    expect(() => buildLBracketMesh(10, 8, 6, 10)).toThrow();
    expect(() => buildLBracketMesh(10, 8, 6, 12)).toThrow();
  });
});
