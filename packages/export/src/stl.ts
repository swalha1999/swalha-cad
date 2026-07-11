import type { CadDocumentV2 } from '@swalha-cad/document';
import {
  buildPrimitiveMesh,
  cross,
  getPosition,
  getTriangleVertexIndices,
  normalize,
  subtract,
  transformPointBy,
  triangleCount,
} from '@swalha-cad/geometry';
import type { Vec3 } from '@swalha-cad/geometry';

const HEADER_SIZE = 80;
const COUNT_SIZE = 4;
const NORMAL_SIZE = 12;
const VERTEX_SIZE = 12;
const ATTRIBUTE_SIZE = 2;
const TRIANGLE_SIZE = NORMAL_SIZE + 3 * VERTEX_SIZE + ATTRIBUTE_SIZE;
const HEADER_TEXT = 'swalha-cad binary STL export';

interface Facet {
  readonly normal: Vec3;
  readonly vertices: readonly [Vec3, Vec3, Vec3];
}

/**
 * Flattens every visible entity's mesh into world-space facets: each
 * triangle's vertices are baked through the entity's model transform, and
 * the facet normal is recomputed from those transformed vertices (rather
 * than reused from the mesh's stored per-vertex normals) so it stays valid
 * for STL's one-normal-per-facet format even where the source mesh uses
 * smooth per-vertex shading, such as a cylinder's side wall.
 */
function collectWorldFacets(document: CadDocumentV2): Facet[] {
  const facets: Facet[] = [];
  for (const entity of document.entities) {
    if (!entity.visible) continue;
    const mesh = buildPrimitiveMesh(entity.primitive);
    for (let t = 0; t < triangleCount(mesh); t++) {
      const [ia, ib, ic] = getTriangleVertexIndices(mesh, t);
      const a = transformPointBy(entity.transform, getPosition(mesh, ia));
      const b = transformPointBy(entity.transform, getPosition(mesh, ib));
      const c = transformPointBy(entity.transform, getPosition(mesh, ic));
      const normal = normalize(cross(subtract(b, a), subtract(c, a)));
      facets.push({ normal, vertices: [a, b, c] });
    }
  }
  return facets;
}

/**
 * Serializes a CAD document's visible entities to a binary STL buffer:
 * an 80-byte header, a uint32 LE triangle count, then per triangle a
 * float32 LE facet normal, its three float32 LE vertices (world-space
 * millimetres, transforms baked in), and a zero uint16 attribute byte count.
 */
export function exportDocumentToBinaryStl(document: CadDocumentV2): Uint8Array {
  const facets = collectWorldFacets(document);

  const buffer = new ArrayBuffer(HEADER_SIZE + COUNT_SIZE + facets.length * TRIANGLE_SIZE);
  const view = new DataView(buffer);

  for (let i = 0; i < HEADER_SIZE; i++) {
    view.setUint8(i, i < HEADER_TEXT.length ? HEADER_TEXT.charCodeAt(i) : 0);
  }
  view.setUint32(HEADER_SIZE, facets.length, true);

  let offset = HEADER_SIZE + COUNT_SIZE;
  const writeVec3 = (v: Vec3): void => {
    view.setFloat32(offset, v[0], true);
    view.setFloat32(offset + 4, v[1], true);
    view.setFloat32(offset + 8, v[2], true);
    offset += VERTEX_SIZE;
  };
  for (const facet of facets) {
    writeVec3(facet.normal);
    writeVec3(facet.vertices[0]);
    writeVec3(facet.vertices[1]);
    writeVec3(facet.vertices[2]);
    view.setUint16(offset, 0, true);
    offset += ATTRIBUTE_SIZE;
  }

  return new Uint8Array(buffer);
}
