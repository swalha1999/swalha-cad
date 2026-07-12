import type { Primitive } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { dot, length, subtract } from '../math/vec3.js';
import { getNormal, getPosition, getTriangleVertexIndices, triangleCount, type EvaluatedFace, type IndexedMesh } from '../mesh.js';
import { buildPrimitiveMesh } from '../build-primitive-mesh.js';
import { buildPrimitiveFaces } from './primitive-faces.js';

/** Every triangle a planar face claims must lie in the face plane with the mesh normal matching. */
function assertPlanarFaceConsistent(mesh: IndexedMesh, face: EvaluatedFace): void {
  for (const tri of face.triangles) {
    const [a, b, c] = getTriangleVertexIndices(mesh, tri);
    for (const v of [a, b, c]) {
      const p = getPosition(mesh, v);
      expect(Math.abs(dot(subtract(p, face.origin), face.normal))).toBeLessThan(1e-5);
    }
    expect(length(subtract(getNormal(mesh, a), face.normal))).toBeLessThan(1e-5);
  }
}

describe('buildPrimitiveFaces', () => {
  it('gives a box six planar axis faces that partition all 12 triangles', () => {
    const primitive: Primitive = { kind: 'box', width: 40, height: 30, depth: 20 };
    const faces = buildPrimitiveFaces(primitive);
    const mesh = buildPrimitiveMesh(primitive);
    expect(faces.map((f) => f.id).sort()).toEqual(['+x', '+y', '+z', '-x', '-y', '-z']);
    expect(faces.every((f) => f.planar)).toBe(true);
    const all = faces.flatMap((f) => f.triangles).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: triangleCount(mesh) }, (_, i) => i));
    for (const face of faces) assertPlanarFaceConsistent(mesh, face);
  });

  it('locates box face origins at the face centres', () => {
    const faces = buildPrimitiveFaces({ kind: 'box', width: 40, height: 30, depth: 20 });
    const px = faces.find((f) => f.id === '+x')!;
    expect(px.origin).toEqual([20, 0, 0]);
    const nz = faces.find((f) => f.id === '-z')!;
    expect(nz.origin).toEqual([0, 0, -10]);
  });

  it('gives a cylinder two planar caps and one curved wall', () => {
    const primitive: Primitive = { kind: 'cylinder', radius: 15, height: 40, segments: 32 };
    const faces = buildPrimitiveFaces(primitive);
    const mesh = buildPrimitiveMesh(primitive);
    expect(faces.map((f) => f.id).sort()).toEqual(['bottom', 'side', 'top']);
    const side = faces.find((f) => f.id === 'side')!;
    expect(side.planar).toBe(false);
    const top = faces.find((f) => f.id === 'top')!;
    const bottom = faces.find((f) => f.id === 'bottom')!;
    expect(top.planar && bottom.planar).toBe(true);
    expect(top.origin).toEqual([0, 20, 0]);
    expect(bottom.origin).toEqual([0, -20, 0]);
    // Triangles still cover the whole mesh.
    const all = faces.flatMap((f) => f.triangles).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: triangleCount(mesh) }, (_, i) => i));
    assertPlanarFaceConsistent(mesh, top);
    assertPlanarFaceConsistent(mesh, bottom);
  });

  it('returns no faces for the L-bracket (out of scope), never throwing', () => {
    expect(buildPrimitiveFaces({ kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 })).toEqual([]);
  });
});
