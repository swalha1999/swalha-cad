import type { Primitive } from '@swalha-cad/document';
import type { IndexedMesh } from './mesh.js';
import { buildBoxMesh } from './primitives/box.js';
import { buildCylinderMesh } from './primitives/cylinder.js';
import { buildLBracketMesh } from './primitives/l-bracket.js';

/** Deterministic, side-effect-free dispatch from a CAD primitive to its indexed mesh. */
export function buildPrimitiveMesh(primitive: Primitive): IndexedMesh {
  switch (primitive.kind) {
    case 'box':
      return buildBoxMesh(primitive.width, primitive.height, primitive.depth);
    case 'cylinder':
      return buildCylinderMesh(primitive.radius, primitive.height, primitive.segments);
    case 'lBracket':
      return buildLBracketMesh(primitive.width, primitive.height, primitive.depth, primitive.thickness);
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unknown primitive kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
