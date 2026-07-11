import type { IndexedMesh } from '@swalha-cad/geometry';
import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Wraps an {@link IndexedMesh}'s typed arrays directly into an indexed
 * `BufferGeometry` with no copying: `positions`/`normals` become vertex
 * attributes and `indices` becomes the geometry index, mirroring the
 * geometry package's own reusable-vertex representation instead of
 * flattening it.
 */
export function createBufferGeometry(mesh: IndexedMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
}
