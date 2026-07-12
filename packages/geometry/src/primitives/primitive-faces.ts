import type { Primitive } from '@swalha-cad/document';
import type { Vec3 } from '../math/vec3.js';
import type { EvaluatedFace } from '../mesh.js';

/**
 * Semantic face provenance for a primitive's mesh, in the primitive's own model
 * space (before its entity transform). Face triangle ranges mirror the exact
 * emission order of the matching `build*Mesh` builder, so a picked triangle maps
 * deterministically back to its semantic face.
 *
 * Coverage is intentionally scoped to the flat faces a sketch can be supported
 * on where it is practical: a box's six axis faces, a cylinder's two circular
 * caps (its wall is reported curved / non-planar). The L-bracket returns no
 * faces yet — its planar walls are left for a later pass rather than broadening
 * scope here.
 */
export function buildPrimitiveFaces(primitive: Primitive): EvaluatedFace[] {
  switch (primitive.kind) {
    case 'box':
      return boxFaces(primitive.width, primitive.height, primitive.depth);
    case 'cylinder':
      return cylinderFaces(primitive.height, primitive.segments);
    case 'lBracket':
      return [];
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unknown primitive kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Six axis-aligned faces in the exact order `buildBoxMesh` emits them (2 triangles each). */
function boxFaces(width: number, height: number, depth: number): EvaluatedFace[] {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const specs: { id: string; normal: Vec3; origin: Vec3 }[] = [
    { id: '+x', normal: [1, 0, 0], origin: [hx, 0, 0] },
    { id: '-x', normal: [-1, 0, 0], origin: [-hx, 0, 0] },
    { id: '+y', normal: [0, 1, 0], origin: [0, hy, 0] },
    { id: '-y', normal: [0, -1, 0], origin: [0, -hy, 0] },
    { id: '+z', normal: [0, 0, 1], origin: [0, 0, hz] },
    { id: '-z', normal: [0, 0, -1], origin: [0, 0, -hz] },
  ];
  return specs.map((spec, k) => ({ ...spec, planar: true, triangles: [2 * k, 2 * k + 1] }));
}

/**
 * A cylinder's two flat caps plus its curved wall, matching `buildCylinderMesh`'s
 * emission order: side wall (`2·segments` triangles), then bottom fan
 * (`segments`), then top fan (`segments`).
 */
function cylinderFaces(height: number, segments: number): EvaluatedFace[] {
  const hy = height / 2;
  const sideTris = 2 * segments;
  const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, k) => from + k);
  return [
    { id: 'side', planar: false, normal: [0, 0, 0], origin: [0, 0, 0], triangles: range(0, sideTris) },
    { id: 'bottom', planar: true, normal: [0, -1, 0], origin: [0, -hy, 0], triangles: range(sideTris, segments) },
    { id: 'top', planar: true, normal: [0, 1, 0], origin: [0, hy, 0], triangles: range(sideTris + segments, segments) },
  ];
}
