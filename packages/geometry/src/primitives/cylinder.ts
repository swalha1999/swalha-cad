import type { Vec3 } from '../math/vec3.js';
import type { IndexedMesh } from '../mesh.js';

/** Builds an indexed cylinder mesh centered at the origin, axis along Y, with smooth side normals and flat cap normals. */
export function buildCylinderMesh(radius: number, height: number, segments: number): IndexedMesh {
  if (!(radius > 0)) {
    throw new Error('Cylinder radius must be positive');
  }
  if (!(height > 0)) {
    throw new Error('Cylinder height must be positive');
  }
  if (!Number.isInteger(segments) || segments < 3) {
    throw new Error('Cylinder segments must be an integer >= 3');
  }

  const hy = height / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const pushVertex = (position: Vec3, normal: Vec3): number => {
    const index = positions.length / 3;
    positions.push(position[0], position[1], position[2]);
    normals.push(normal[0], normal[1], normal[2]);
    return index;
  };

  const rimPoint = (i: number): Vec3 => {
    const theta = (2 * Math.PI * i) / segments;
    return [radius * Math.cos(theta), 0, radius * Math.sin(theta)];
  };

  // Side wall: one ring of vertices per height, smooth radial normals shared between adjacent triangles.
  const bottomRing: number[] = [];
  const topRing: number[] = [];
  for (let i = 0; i < segments; i++) {
    const [x, , z] = rimPoint(i);
    const normal: Vec3 = [x / radius, 0, z / radius];
    bottomRing.push(pushVertex([x, -hy, z], normal));
    topRing.push(pushVertex([x, hy, z], normal));
  }
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments;
    indices.push(bottomRing[i2]!, bottomRing[i]!, topRing[i2]!);
    indices.push(bottomRing[i]!, topRing[i]!, topRing[i2]!);
  }

  // Caps: independent vertices with flat axial normals, distinct from the side ring at the same position.
  const bottomCenter = pushVertex([0, -hy, 0], [0, -1, 0]);
  const bottomRim: number[] = [];
  for (let i = 0; i < segments; i++) {
    const [x, , z] = rimPoint(i);
    bottomRim.push(pushVertex([x, -hy, z], [0, -1, 0]));
  }
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments;
    indices.push(bottomCenter, bottomRim[i]!, bottomRim[i2]!);
  }

  const topCenter = pushVertex([0, hy, 0], [0, 1, 0]);
  const topRim: number[] = [];
  for (let i = 0; i < segments; i++) {
    const [x, , z] = rimPoint(i);
    topRim.push(pushVertex([x, hy, z], [0, 1, 0]));
  }
  for (let i = 0; i < segments; i++) {
    const i2 = (i + 1) % segments;
    indices.push(topCenter, topRim[i2]!, topRim[i]!);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
  };
}
