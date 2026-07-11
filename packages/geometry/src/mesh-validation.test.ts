import { describe, expect, it } from 'vitest';
import type { IndexedMesh } from './mesh.js';
import { areIndicesInRange, areNormalsOutward, areNormalsUnitLength, computeMeshBounds, hasZeroAreaTriangles, isWatertight, isWindingOutward } from './mesh-validation.js';

function tetrahedron(): IndexedMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]),
    normals: new Float32Array(12),
  };
}

function outwardTriangle(): IndexedMesh {
  return {
    positions: new Float32Array([-1, -1, 1, 1, -1, 1, 0, 1, 1]),
    indices: new Uint32Array([0, 1, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  };
}

describe('computeMeshBounds', () => {
  it('returns the min/max extents of the mesh positions', () => {
    const bounds = computeMeshBounds(outwardTriangle());
    expect(bounds.min).toEqual([-1, -1, 1]);
    expect(bounds.max).toEqual([1, 1, 1]);
  });

  it('throws for an empty mesh', () => {
    const mesh: IndexedMesh = { positions: new Float32Array([]), indices: new Uint32Array([]), normals: new Float32Array([]) };
    expect(() => computeMeshBounds(mesh)).toThrow();
  });
});

describe('areIndicesInRange', () => {
  it('accepts indices that reference existing vertices', () => {
    expect(areIndicesInRange(outwardTriangle())).toBe(true);
  });

  it('rejects an index beyond the vertex count', () => {
    const mesh = outwardTriangle();
    mesh.indices[2] = 5;
    expect(areIndicesInRange(mesh)).toBe(false);
  });

  it('rejects an index buffer that is not a multiple of 3', () => {
    const mesh = outwardTriangle();
    mesh.indices = new Uint32Array([0, 1]);
    expect(areIndicesInRange(mesh)).toBe(false);
  });
});

describe('hasZeroAreaTriangles', () => {
  it('is false for a triangle with positive area', () => {
    expect(hasZeroAreaTriangles(outwardTriangle())).toBe(false);
  });

  it('is true for a degenerate (collinear) triangle', () => {
    const mesh: IndexedMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    };
    expect(hasZeroAreaTriangles(mesh)).toBe(true);
  });
});

describe('areNormalsUnitLength', () => {
  it('is true when every normal has unit length', () => {
    expect(areNormalsUnitLength(outwardTriangle())).toBe(true);
  });

  it('is false when a normal is not unit length', () => {
    const mesh = outwardTriangle();
    mesh.normals[2] = 2;
    expect(areNormalsUnitLength(mesh)).toBe(false);
  });
});

describe('isWindingOutward', () => {
  it('is true when the triangle winds away from the origin', () => {
    expect(isWindingOutward(outwardTriangle())).toBe(true);
  });

  it('is false when the triangle is wound toward the origin', () => {
    const mesh = outwardTriangle();
    mesh.indices = new Uint32Array([0, 2, 1]);
    expect(isWindingOutward(mesh)).toBe(false);
  });
});

describe('isWatertight', () => {
  it('is true when every undirected edge of a closed solid occurs exactly twice', () => {
    expect(isWatertight(tetrahedron())).toBe(true);
  });

  it('is false for a single open triangle whose edges each occur once', () => {
    expect(isWatertight(outwardTriangle())).toBe(false);
  });

  it('is false when an edge is shared by three triangles instead of two', () => {
    const mesh = tetrahedron();
    mesh.indices = new Uint32Array([...mesh.indices, 0, 1, 2]);
    expect(isWatertight(mesh)).toBe(false);
  });

  it('treats vertices at coincident positions but distinct indices as the same edge endpoint', () => {
    const mesh = tetrahedron();
    mesh.positions = new Float32Array([...mesh.positions, 0, 0, 0]);
    mesh.indices = new Uint32Array([0, 1, 2, 0, 3, 1, 4, 2, 3, 1, 3, 2]);
    mesh.normals = new Float32Array([...mesh.normals, 0, 0, 0]);
    expect(isWatertight(mesh)).toBe(true);
  });
});

describe('areNormalsOutward', () => {
  it('is true when normals point away from the origin', () => {
    expect(areNormalsOutward(outwardTriangle())).toBe(true);
  });

  it('is false when normals point toward the origin', () => {
    const mesh = outwardTriangle();
    for (let i = 0; i < mesh.normals.length; i++) {
      mesh.normals[i] = -mesh.normals[i]!;
    }
    expect(areNormalsOutward(mesh)).toBe(false);
  });
});
