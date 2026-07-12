import type { SketchFeature } from '@swalha-cad/document';
import type { Vec3 } from '../math/vec3.js';
import { add, normalize, scale } from '../math/vec3.js';
import type { IndexedMesh } from '../mesh.js';
import { sampleArcEdge } from '../sketch/curves.js';
import type { OrientedCurveEdge } from '../sketch/loop.js';
import { getPlaneFrame, sketchPointToModel, sketchVectorToModel, type Vec2 } from '../sketch/plane.js';
import { detectSketchProfile, type SketchProfile } from '../sketch/profile.js';
import { indexSketchEntities, type TopologyIssue } from '../sketch/topology.js';
import { triangulateSimplePolygon } from './triangulate-profile.js';

/** How far and in which direction a profile is swept along its plane's normal. */
export interface ExtrudeOptions {
  /** Sweep distance in mm; must be finite and strictly positive. */
  readonly depth: number;
  /** `normal` sweeps from the plane to `+normal * depth`; `symmetric` straddles the plane by `depth / 2` each way. */
  readonly direction: 'normal' | 'symmetric';
}

export type ExtrudeErrorCode = 'invalid-depth' | 'invalid-profile' | 'degenerate-profile';

/** A structured reason an extrusion could not be produced, carrying any profile-detection diagnostics. */
export interface ExtrudeError {
  readonly code: ExtrudeErrorCode;
  readonly message: string;
  readonly issues: readonly TopologyIssue[];
}

export type ExtrudeResult =
  | { readonly ok: true; readonly mesh: IndexedMesh }
  | { readonly ok: false; readonly error: ExtrudeError };

/** Fixed circle tessellation count; constant so a given circle always yields byte-identical geometry. */
const CIRCLE_SEGMENTS = 64;

function fail(code: ExtrudeErrorCode, message: string, issues: readonly TopologyIssue[] = []): ExtrudeResult {
  return { ok: false, error: { code, message, issues } };
}

function allFinite(p: Vec2): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Flattens one closed curve loop into a counter-clockwise ring of 2D points.
 * Each edge is sampled from its own start toward its end — a line contributes its
 * two endpoints, an arc a deterministic run of chords (see
 * {@link sampleArcEdge})' — and every edge drops its final point, which is the
 * next edge's start, so adjacent edges join without duplicating the shared
 * vertex. Returns a structured degenerate-profile error for any non-finite
 * coordinate.
 */
function curveLoopRing(edges: readonly OrientedCurveEdge[]): { ring: Vec2[] } | { error: ExtrudeResult } {
  const ring: Vec2[] = [];
  for (const edge of edges) {
    const points = edge.kind === 'arc' ? sampleArcEdge(edge.arc!, edge.start) : [edge.start, edge.end];
    for (let i = 0; i < points.length - 1; i++) {
      const point = points[i]!;
      if (!allFinite(point)) {
        return { error: fail('degenerate-profile', `Profile edge ${edge.id} produced a non-finite point.`) };
      }
      ring.push(point);
    }
  }
  if (ring.length < 3) {
    return { error: fail('degenerate-profile', 'Curve loop tessellated to fewer than 3 distinct points.') };
  }
  return { ring };
}

/**
 * Resolves a detected profile into an ordered, counter-clockwise ring of 2D
 * sketch-plane points. Line loops reuse the profile's normalized point order;
 * circles are tessellated counter-clockwise into {@link CIRCLE_SEGMENTS}
 * vertices. Returns `null` with a structured error when the geometry is
 * degenerate (missing coordinates or a non-positive radius).
 */
function profileRing(sketch: SketchFeature, profile: SketchProfile): { ring: Vec2[] } | { error: ExtrudeResult } {
  const index = indexSketchEntities(sketch.entities);

  if (profile.kind === 'line-loop') {
    const ring: Vec2[] = [];
    for (const id of profile.pointIds) {
      const point = index.points.get(id)!;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { error: fail('degenerate-profile', `Profile point ${id} has non-finite coordinates.`) };
      }
      ring.push([point.x, point.y]);
    }
    return { ring };
  }

  if (profile.kind === 'curve-loop') {
    return curveLoopRing(profile.edges);
  }

  if (!Number.isFinite(profile.radius) || profile.radius <= 0) {
    return { error: fail('degenerate-profile', `Circle ${profile.circleId} has a non-positive or non-finite radius.`) };
  }
  const center = index.points.get(profile.centerId)!;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return { error: fail('degenerate-profile', `Circle center ${profile.centerId} has non-finite coordinates.`) };
  }
  const ring: Vec2[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const theta = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    ring.push([center.x + profile.radius * Math.cos(theta), center.y + profile.radius * Math.sin(theta)]);
  }
  return { ring };
}

/**
 * Converts a sketch's single detected closed profile into an indexed,
 * watertight triangle mesh swept along the sketch plane's normal.
 *
 * The profile is detected and winding-normalized by `detectSketchProfile`, so
 * the input order of the source edges and their individual directions do not
 * affect the result. Caps are triangulated deterministically by ear clipping;
 * side walls are generated directly per ring edge. Every face carries a flat,
 * unit, outward normal on its own duplicated vertices, which makes each
 * undirected boundary edge shared by exactly two triangles (watertight) while
 * keeping hard shading. Structured errors are returned — never thrown — for
 * invalid depth and for open, self-intersecting, ambiguous, or degenerate
 * profiles.
 */
export function extrudeSketch(sketch: SketchFeature, options: ExtrudeOptions): ExtrudeResult {
  const { depth, direction } = options;
  if (!Number.isFinite(depth) || depth <= 0) {
    return fail('invalid-depth', `Extrusion depth must be finite and positive, got ${depth}.`);
  }

  const detected = detectSketchProfile(sketch);
  if (!detected.ok) {
    return fail('invalid-profile', 'Sketch does not contain exactly one extrudable closed profile.', detected.issues);
  }

  const resolved = profileRing(sketch, detected.profile);
  if ('error' in resolved) return resolved.error;
  const { ring } = resolved;

  const frame = getPlaneFrame(sketch.plane);
  const bottomOffset = direction === 'symmetric' ? -depth / 2 : 0;
  const topOffset = direction === 'symmetric' ? depth / 2 : depth;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const pushVertex = (position: Vec3, normal: Vec3): number => {
    const vertex = positions.length / 3;
    positions.push(position[0], position[1], position[2]);
    normals.push(normal[0], normal[1], normal[2]);
    return vertex;
  };

  // Embed a ring point at a given signed distance along the plane normal.
  const modelAt = (p: Vec2, offset: number): Vec3 => add(sketchPointToModel(frame, p), scale(frame.normal, offset));

  const capTriangles = triangulateSimplePolygon(ring);

  // Top cap faces along +normal; its counter-clockwise ring already winds outward.
  const topNormal = frame.normal;
  const topVertices = ring.map((p) => pushVertex(modelAt(p, topOffset), topNormal));
  for (const [a, b, c] of capTriangles) {
    indices.push(topVertices[a]!, topVertices[b]!, topVertices[c]!);
  }

  // Bottom cap faces along -normal; reverse each triangle so its winding flips.
  const bottomNormal = scale(frame.normal, -1);
  const bottomVertices = ring.map((p) => pushVertex(modelAt(p, bottomOffset), bottomNormal));
  for (const [a, b, c] of capTriangles) {
    indices.push(bottomVertices[a]!, bottomVertices[c]!, bottomVertices[b]!);
  }

  // Side walls: one quad per ring edge, its outward normal being the edge's
  // right-hand (exterior) direction for the counter-clockwise ring.
  for (let i = 0; i < ring.length; i++) {
    const start = ring[i]!;
    const end = ring[(i + 1) % ring.length]!;
    const edge: Vec2 = [end[0] - start[0], end[1] - start[1]];
    const outward = normalize(sketchVectorToModel(frame, [edge[1], -edge[0]]));

    const bottomStart = pushVertex(modelAt(start, bottomOffset), outward);
    const bottomEnd = pushVertex(modelAt(end, bottomOffset), outward);
    const topEnd = pushVertex(modelAt(end, topOffset), outward);
    const topStart = pushVertex(modelAt(start, topOffset), outward);

    indices.push(bottomStart, bottomEnd, topEnd, bottomStart, topEnd, topStart);
  }

  return {
    ok: true,
    mesh: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      normals: new Float32Array(normals),
    },
  };
}
