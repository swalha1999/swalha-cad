import type { Vec3 } from './math/vec3.js';
import { cross, dot, length, subtract } from './math/vec3.js';
import type { IndexedMesh } from './mesh.js';
import { getPosition, getNormal, getTriangleVertexIndices, triangleCount, vertexCount } from './mesh.js';

export interface MeshBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function computeMeshBounds(mesh: IndexedMesh): MeshBounds {
  const { positions } = mesh;
  if (positions.length === 0) {
    throw new Error('Cannot compute bounds of an empty mesh');
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** True if the index buffer is a whole number of triangles and every index references an existing vertex. */
export function areIndicesInRange(mesh: IndexedMesh): boolean {
  if (mesh.indices.length % 3 !== 0) return false;
  const count = vertexCount(mesh);
  for (const index of mesh.indices) {
    if (index < 0 || index >= count) return false;
  }
  return true;
}

/** Cross product of a triangle's edges: its direction encodes winding, its length is twice the triangle's area. */
function triangleFaceCross(mesh: IndexedMesh, triangleIndex: number): Vec3 {
  const [ia, ib, ic] = getTriangleVertexIndices(mesh, triangleIndex);
  const a = getPosition(mesh, ia);
  const b = getPosition(mesh, ib);
  const c = getPosition(mesh, ic);
  return cross(subtract(b, a), subtract(c, a));
}

export function triangleArea(mesh: IndexedMesh, triangleIndex: number): number {
  return length(triangleFaceCross(mesh, triangleIndex)) / 2;
}

export function hasZeroAreaTriangles(mesh: IndexedMesh, epsilon = 1e-9): boolean {
  for (let t = 0; t < triangleCount(mesh); t++) {
    if (triangleArea(mesh, t) <= epsilon) return true;
  }
  return false;
}

export function areNormalsUnitLength(mesh: IndexedMesh, epsilon = 1e-6): boolean {
  for (let v = 0; v < vertexCount(mesh); v++) {
    if (Math.abs(length(getNormal(mesh, v)) - 1) > epsilon) return false;
  }
  return true;
}

/**
 * True if every triangle's winding faces away from `origin`, i.e. the cross
 * product of its edges points away from the interior. Valid for meshes that
 * are star-shaped with respect to `origin` (box, cylinder, and other convex
 * primitives centered at the origin).
 */
export function isWindingOutward(mesh: IndexedMesh, origin: Vec3 = [0, 0, 0], epsilon = 1e-9): boolean {
  for (let t = 0; t < triangleCount(mesh); t++) {
    const [ia] = getTriangleVertexIndices(mesh, t);
    const a = getPosition(mesh, ia);
    const faceCross = triangleFaceCross(mesh, t);
    if (dot(faceCross, subtract(a, origin)) <= epsilon) return false;
  }
  return true;
}

/**
 * True if every stored vertex normal points away from `origin`. Valid under
 * the same star-shaped assumption as {@link isWindingOutward}.
 */
export function areNormalsOutward(mesh: IndexedMesh, origin: Vec3 = [0, 0, 0], epsilon = 1e-9): boolean {
  for (let v = 0; v < vertexCount(mesh); v++) {
    const p = getPosition(mesh, v);
    const n = getNormal(mesh, v);
    if (dot(n, subtract(p, origin)) <= epsilon) return false;
  }
  return true;
}

function positionKey(p: Vec3, precision: number): string {
  const round = (value: number) => Math.round(value / precision);
  return `${round(p[0])}:${round(p[1])}:${round(p[2])}`;
}

/**
 * True if every undirected edge, identified by its endpoint positions rather
 * than vertex indices, occurs in exactly two triangles. Position-based
 * identity is required because hard-edged meshes in this codebase duplicate
 * vertices per face for flat shading, so a shared boundary edge never shares
 * vertex indices across the two faces that meet at it.
 */
export function isWatertight(mesh: IndexedMesh, precision = 1e-5): boolean {
  const edgeCounts = new Map<string, number>();
  for (let t = 0; t < triangleCount(mesh); t++) {
    const triangle = getTriangleVertexIndices(mesh, t);
    for (let e = 0; e < 3; e++) {
      const a = positionKey(getPosition(mesh, triangle[e]!), precision);
      const b = positionKey(getPosition(mesh, triangle[(e + 1) % 3]!), precision);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  for (const count of edgeCounts.values()) {
    if (count !== 2) return false;
  }
  return true;
}
