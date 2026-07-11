import type { Vec3 } from '../math/vec3.js';
import { normalize } from '../math/vec3.js';
import type { IndexedMesh } from '../mesh.js';

type Vec2 = readonly [number, number];

/**
 * Builds an indexed L-bracket mesh centered at the origin: a concave hexagonal
 * profile (two legs of `thickness` meeting at a right angle) extruded along Z
 * by `depth`, with hard edges (flat shading) like the box and cylinder
 * primitives. Generated directly as a single watertight solid rather than as
 * overlapping boxes, since overlapping internal faces are not fabrication-safe.
 */
export function buildLBracketMesh(width: number, height: number, depth: number, thickness: number): IndexedMesh {
  if (!(width > 0) || !(height > 0) || !(depth > 0)) {
    throw new Error('L-bracket width, height, and depth must be positive');
  }
  if (!(thickness > 0)) {
    throw new Error('L-bracket thickness must be positive');
  }
  if (!(thickness < width) || !(thickness < height)) {
    throw new Error('L-bracket thickness must be strictly less than both width and height');
  }

  const hz = depth / 2;
  const x0 = -width / 2;
  const x1 = x0 + thickness;
  const x2 = width / 2;
  const y0 = -height / 2;
  const y1 = y0 + thickness;
  const y2 = height / 2;

  // Six-vertex concave profile, wound counter-clockwise (positive signed area)
  // when viewed from +Z: the outer L boundary with a single reflex corner.
  const profile: readonly Vec2[] = [
    [x0, y0],
    [x2, y0],
    [x2, y1],
    [x1, y1],
    [x1, y2],
    [x0, y2],
  ];
  const segmentCount = profile.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const pushVertex = (position: Vec3, normal: Vec3): number => {
    const index = positions.length / 3;
    positions.push(position[0], position[1], position[2]);
    normals.push(normal[0], normal[1], normal[2]);
    return index;
  };

  // Caps: fan-triangulated from profile[0], a convex vertex that sees every
  // other vertex of this L-shape without crossing the boundary.
  const buildCap = (z: number, normal: Vec3, reverseWinding: boolean): void => {
    const cap = profile.map(([x, y]) => pushVertex([x, y, z], normal));
    for (let i = 1; i < segmentCount - 1; i++) {
      const a = cap[0]!;
      const b = cap[i]!;
      const c = cap[i + 1]!;
      if (reverseWinding) {
        indices.push(a, c, b);
      } else {
        indices.push(a, b, c);
      }
    }
  };
  buildCap(hz, [0, 0, 1], false);
  buildCap(-hz, [0, 0, -1], true);

  // Side walls: one flat-shaded quad per profile edge, outward normal from
  // rotating the edge direction -90 degrees (valid for this CCW polygon).
  for (let i = 0; i < segmentCount; i++) {
    const [xa, ya] = profile[i]!;
    const [xb, yb] = profile[(i + 1) % segmentCount]!;
    const [nx, ny] = normalize([yb - ya, -(xb - xa), 0]);
    const normal: Vec3 = [nx, ny, 0];

    const a = pushVertex([xa, ya, -hz], normal);
    const b = pushVertex([xb, yb, -hz], normal);
    const c = pushVertex([xb, yb, hz], normal);
    const d = pushVertex([xa, ya, hz], normal);
    indices.push(a, b, c, a, c, d);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
  };
}
