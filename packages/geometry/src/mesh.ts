import type { Vec3 } from './math/vec3.js';

/**
 * A reusable-vertex triangle mesh: `indices` groups into triangles of three
 * vertex indices into `positions`/`normals`, each stored as flat xyz triples.
 */
export interface IndexedMesh {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
}

export function vertexCount(mesh: IndexedMesh): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: IndexedMesh): number {
  return mesh.indices.length / 3;
}

export function getPosition(mesh: IndexedMesh, vertexIndex: number): Vec3 {
  const i = vertexIndex * 3;
  return [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!];
}

export function getNormal(mesh: IndexedMesh, vertexIndex: number): Vec3 {
  const i = vertexIndex * 3;
  return [mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!];
}

export function getTriangleVertexIndices(mesh: IndexedMesh, triangleIndex: number): readonly [number, number, number] {
  const i = triangleIndex * 3;
  return [mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!];
}
