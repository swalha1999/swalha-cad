import type { SketchFeature } from '@swalha-cad/document';
import type { Vec3 } from '../math/vec3.js';
import { add, normalize, scale } from '../math/vec3.js';
import type { EvaluatedFace, IndexedMesh } from '../mesh.js';
import { sampleArcEdge } from '../sketch/curves.js';
import type { OrientedCurveEdge } from '../sketch/loop.js';
import { getPlaneFrame, sketchPointToModel, sketchVectorToModel, type PlaneFrame, type Vec2 } from '../sketch/plane.js';
import { detectSketchProfile, type SketchProfile } from '../sketch/profile.js';
import { indexSketchEntities, type TopologyIssue } from '../sketch/topology.js';
import { triangulateSimplePolygon } from './triangulate-profile.js';

/** How far and in which direction a profile is swept along its plane's normal. */
export interface ExtrudeOptions {
  /** Sweep distance in mm; must be finite and strictly positive. */
  readonly depth: number;
  /** `normal` sweeps from the plane to `+normal * depth`; `symmetric` straddles the plane by `depth / 2` each way. */
  readonly direction: 'normal' | 'symmetric';
  /**
   * Flips a `normal` sweep to the far side of the plane (`0` → `-depth` instead
   * of `0` → `+depth`), keeping the same watertight outward-facing solid. Has no
   * effect on a `symmetric` sweep, which is already balanced about the plane.
   */
  readonly reverse?: boolean;
  /**
   * The model-space frame the profile is embedded through. Defaults to the
   * sketch's origin-plane frame ({@link getPlaneFrame}); a face-supported sketch
   * passes the resolved planar-face frame so the solid is built directly on the
   * face in world space.
   */
  readonly frame?: PlaneFrame;
}

export type ExtrudeErrorCode = 'invalid-depth' | 'invalid-profile' | 'degenerate-profile';

/** A structured reason an extrusion could not be produced, carrying any profile-detection diagnostics. */
export interface ExtrudeError {
  readonly code: ExtrudeErrorCode;
  readonly message: string;
  readonly issues: readonly TopologyIssue[];
}

export type ExtrudeResult =
  | { readonly ok: true; readonly mesh: IndexedMesh; readonly faces: readonly EvaluatedFace[] }
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
 * Provenance for one ring segment (from ring vertex `i` to `i + 1`): the id of
 * the source sketch edge it came from and whether that edge is curved. Straight
 * edges become one planar side face each; consecutive curved segments sharing a
 * `sourceId` (an arc's chords, a circle's tessellation) group into one curved
 * side face that a sketch cannot be supported on.
 */
interface RingSegment {
  readonly sourceId: string;
  readonly curved: boolean;
}

type RingResult = { ring: Vec2[]; segments: RingSegment[] } | { error: ExtrudeResult };

/**
 * Flattens one closed curve loop into a counter-clockwise ring of 2D points and
 * the per-segment provenance ({@link RingSegment}) aligned with it. Each edge is
 * sampled from its own start toward its end and drops its final point (the next
 * edge's start) so adjacent edges join without duplicating the shared vertex.
 */
function curveLoopRing(edges: readonly OrientedCurveEdge[]): RingResult {
  const ring: Vec2[] = [];
  const segments: RingSegment[] = [];
  for (const edge of edges) {
    const curved = edge.kind === 'arc';
    const points = edge.kind === 'arc' ? sampleArcEdge(edge.arc!, edge.start) : [edge.start, edge.end];
    for (let i = 0; i < points.length - 1; i++) {
      const point = points[i]!;
      if (!allFinite(point)) {
        return { error: fail('degenerate-profile', `Profile edge ${edge.id} produced a non-finite point.`) };
      }
      ring.push(point);
      segments.push({ sourceId: edge.id, curved });
    }
  }
  if (ring.length < 3) {
    return { error: fail('degenerate-profile', 'Curve loop tessellated to fewer than 3 distinct points.') };
  }
  return { ring, segments };
}

/**
 * Resolves a detected profile into an ordered, counter-clockwise ring of 2D
 * sketch-plane points plus each ring segment's source-edge provenance. Line
 * loops reuse the profile's normalized order (each segment tied to its source
 * line id); circles are tessellated counter-clockwise into
 * {@link CIRCLE_SEGMENTS} curved segments. Returns a structured error when the
 * geometry is degenerate.
 */
function profileRing(sketch: SketchFeature, profile: SketchProfile): RingResult {
  const index = indexSketchEntities(sketch.entities);

  if (profile.kind === 'line-loop') {
    const ring: Vec2[] = [];
    const segments: RingSegment[] = [];
    profile.pointIds.forEach((id, i) => {
      const point = index.points.get(id)!;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return; // recorded below via the length check
      }
      ring.push([point.x, point.y]);
      segments.push({ sourceId: profile.lineIds[i]!, curved: false });
    });
    if (ring.length !== profile.pointIds.length) {
      return { error: fail('degenerate-profile', 'Profile point has non-finite coordinates.') };
    }
    return { ring, segments };
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
  const segments: RingSegment[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const theta = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    ring.push([center.x + profile.radius * Math.cos(theta), center.y + profile.radius * Math.sin(theta)]);
    segments.push({ sourceId: profile.circleId, curved: true });
  }
  return { ring, segments };
}

/**
 * Converts a sketch's single detected closed profile into an indexed,
 * watertight triangle mesh swept along the frame normal, together with the
 * {@link EvaluatedFace} provenance for its top/bottom caps and side walls.
 *
 * The profile is detected and winding-normalized by `detectSketchProfile`, so
 * the input order of the source edges and their individual directions do not
 * affect the result. Caps are triangulated deterministically by ear clipping;
 * side walls are generated directly per ring edge. Every face carries a flat,
 * unit, outward normal on its own duplicated vertices, which makes each
 * undirected boundary edge shared by exactly two triangles (watertight) while
 * keeping hard shading. Each straight ring edge yields one planar side face
 * (`side:<edgeId>`); runs of curved segments group into one non-planar side
 * face. Structured errors are returned — never thrown — for invalid depth and
 * for open, self-intersecting, ambiguous, or degenerate profiles.
 */
export function extrudeSketch(sketch: SketchFeature, options: ExtrudeOptions): ExtrudeResult {
  const { depth, direction, reverse = false } = options;
  if (!Number.isFinite(depth) || depth <= 0) {
    return fail('invalid-depth', `Extrusion depth must be finite and positive, got ${depth}.`);
  }

  const detected = detectSketchProfile(sketch);
  if (!detected.ok) {
    return fail('invalid-profile', 'Sketch does not contain exactly one extrudable closed profile.', detected.issues);
  }

  const resolved = profileRing(sketch, detected.profile);
  if ('error' in resolved) return resolved.error;
  const { ring, segments } = resolved;

  const frame = options.frame ?? getPlaneFrame(sketch.plane);
  // Both caps are always placed with `topOffset > bottomOffset`, so the +normal
  // top cap stays the higher face and every outward normal/winding is preserved
  // regardless of direction: symmetric straddles the plane, a normal sweep runs
  // 0 → +depth, and a reversed normal sweep runs -depth → 0 (the far side).
  const bottomOffset = direction === 'symmetric' ? -depth / 2 : reverse ? -depth : 0;
  const topOffset = direction === 'symmetric' ? depth / 2 : reverse ? 0 : depth;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const pushVertex = (position: Vec3, normal: Vec3): number => {
    const vertex = positions.length / 3;
    positions.push(position[0], position[1], position[2]);
    normals.push(normal[0], normal[1], normal[2]);
    return vertex;
  };

  // Embed a ring point at a given signed distance along the frame normal.
  const modelAt = (p: Vec2, offset: number): Vec3 => add(sketchPointToModel(frame, p), scale(frame.normal, offset));

  const capTriangles = triangulateSimplePolygon(ring);
  const capCount = capTriangles.length;

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

  // Side walls: one quad (two triangles) per ring edge, its outward normal being
  // the edge's right-hand (exterior) direction for the counter-clockwise ring.
  const sideOutward: Vec3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const start = ring[i]!;
    const end = ring[(i + 1) % ring.length]!;
    const edge: Vec2 = [end[0] - start[0], end[1] - start[1]];
    const outward = normalize(sketchVectorToModel(frame, [edge[1], -edge[0]]));
    sideOutward.push(outward);

    const bottomStart = pushVertex(modelAt(start, bottomOffset), outward);
    const bottomEnd = pushVertex(modelAt(end, bottomOffset), outward);
    const topEnd = pushVertex(modelAt(end, topOffset), outward);
    const topStart = pushVertex(modelAt(start, topOffset), outward);

    indices.push(bottomStart, bottomEnd, topEnd, bottomStart, topEnd, topStart);
  }

  const mesh: IndexedMesh = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
  };

  // Face provenance: the two caps, then side faces grouped by source edge. The
  // cap centroid is the ring centroid embedded at the cap offset (embedding is
  // affine, so the mean of embedded points equals the embedded mean).
  const ringCentroid: Vec2 = [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
  const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, k) => from + k);

  const faces: EvaluatedFace[] = [
    { id: 'top', planar: true, normal: topNormal, origin: modelAt(ringCentroid, topOffset), triangles: range(0, capCount) },
    { id: 'bottom', planar: true, normal: bottomNormal, origin: modelAt(ringCentroid, bottomOffset), triangles: range(capCount, capCount) },
  ];

  const sideStart = 2 * capCount;
  const midOffset = (topOffset + bottomOffset) / 2;
  let i = 0;
  while (i < ring.length) {
    const seg = segments[i]!;
    const tris: number[] = [];
    let sumOutward: Vec3 = [0, 0, 0];
    let sumMid: Vec2 = [0, 0];
    let count = 0;
    let j = i;
    while (j < ring.length && segments[j]!.sourceId === seg.sourceId) {
      const base = sideStart + j * 2;
      tris.push(base, base + 1);
      const start = ring[j]!;
      const end = ring[(j + 1) % ring.length]!;
      sumOutward = add(sumOutward, sideOutward[j]!);
      sumMid = [sumMid[0] + (start[0] + end[0]) / 2, sumMid[1] + (start[1] + end[1]) / 2];
      count++;
      j++;
    }
    const planar = !seg.curved && count === 1;
    faces.push({
      id: `side:${seg.sourceId}`,
      planar,
      normal: normalize(sumOutward),
      origin: modelAt([sumMid[0] / count, sumMid[1] / count], midOffset),
      triangles: tris,
    });
    i = j;
  }

  return { ok: true, mesh, faces };
}
