import type { CadDocumentV2 } from '@swalha-cad/document';
import {
  buildPrimitiveMesh,
  cross,
  evaluateDocument,
  getPosition,
  getTriangleVertexIndices,
  normalize,
  subtract,
  transformPointBy,
  triangleCount,
} from '@swalha-cad/geometry';
import type { EvaluatedBody, IndexedMesh, Vec3 } from '@swalha-cad/geometry';

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
 * The world-space mesh a body contributes and a function mapping each of its
 * vertices to world space: an M1 primitive is tessellated and baked through
 * its model transform, while a derived feature solid is already world-space
 * and used verbatim under the identity.
 */
function worldMeshOf(body: EvaluatedBody): { mesh: IndexedMesh; toWorld: (v: Vec3) => Vec3 } {
  if (body.geometry.kind === 'primitive') {
    const { transform } = body.geometry;
    return { mesh: buildPrimitiveMesh(body.geometry.primitive), toWorld: (v) => transformPointBy(transform, v) };
  }
  return { mesh: body.geometry.mesh, toWorld: (v) => v };
}

/**
 * Flattens every visible evaluated body's mesh into world-space facets: each
 * triangle's vertices are baked into world space (through the primitive's
 * model transform, or unchanged for an already-world-space derived solid), and
 * the facet normal is recomputed from those world vertices (rather than reused
 * from the mesh's stored per-vertex normals) so it stays valid for STL's
 * one-normal-per-facet format even where the source mesh uses smooth per-vertex
 * shading, such as a cylinder's side wall.
 *
 * Bodies come from `evaluateDocument`, so this includes retained M1 primitives
 * and derived solids for valid visible extrudes, and excludes non-solid
 * sketches, hidden extrudes, and broken feature references (never stale
 * geometry).
 */
function collectWorldFacets(document: CadDocumentV2): Facet[] {
  const facets: Facet[] = [];
  for (const body of evaluateDocument(document).bodies) {
    if (!body.visible) continue;
    const { mesh, toWorld } = worldMeshOf(body);
    for (let t = 0; t < triangleCount(mesh); t++) {
      const [ia, ib, ic] = getTriangleVertexIndices(mesh, t);
      const a = toWorld(getPosition(mesh, ia));
      const b = toWorld(getPosition(mesh, ib));
      const c = toWorld(getPosition(mesh, ic));
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
