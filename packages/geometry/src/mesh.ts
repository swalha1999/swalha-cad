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

/**
 * Semantic provenance for one topological face of an evaluated body's mesh. It
 * groups the mesh triangles that make up the face (indices into the mesh's
 * triangle list — see {@link getTriangleVertexIndices}) and carries the face's
 * outward `normal` and a representative on-face point (`origin`, its centroid),
 * both in the body's own mesh space. `id` is a deterministic semantic name
 * (e.g. `'top'`, `'bottom'`, `'side:<edgeId>'`, `'+x'`) that is stable across
 * rebuilds so a downstream sketch can reference the face without ever storing a
 * transient Three.js face index. `planar` is true only for flat faces a sketch
 * can be supported on; curved faces (a cylinder wall, a circle extrusion side)
 * are reported with `planar: false` so they can be rejected with a diagnostic.
 */
export interface EvaluatedFace {
  readonly id: string;
  readonly planar: boolean;
  readonly normal: Vec3;
  readonly origin: Vec3;
  readonly triangles: readonly number[];
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
