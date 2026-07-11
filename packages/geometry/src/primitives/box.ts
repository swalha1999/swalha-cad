import type { Vec3 } from '../math/vec3.js';
import type { IndexedMesh } from '../mesh.js';

interface BoxFace {
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
}

/** Builds an indexed box mesh centered at the origin, with hard edges (4 vertices per face, CCW winding viewed from outside). */
export function buildBoxMesh(width: number, height: number, depth: number): IndexedMesh {
  if (!(width > 0) || !(height > 0) || !(depth > 0)) {
    throw new Error('Box dimensions must be positive');
  }

  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;

  const faces: readonly BoxFace[] = [
    { corners: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], normal: [1, 0, 0] },
    { corners: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], normal: [-1, 0, 0] },
    { corners: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], normal: [0, 1, 0] },
    { corners: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], normal: [0, -1, 0] },
    { corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], normal: [0, 0, 1] },
    { corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], normal: [0, 0, -1] },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
  };
}
