import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import {
  findCurveLoopIntersections,
  findLoopSelfIntersections,
  type CurveLoopSegment,
  type LoopSegment,
} from './intersections.js';
import { analyzeCurveLoopTopology, type OrientedCurveEdge } from './loop.js';
import { analyzeLineLoopTopology, indexSketchEntities, type ClosedLineLoop, type TopologyIssue } from './topology.js';
import type { Vec2 } from './plane.js';

/** A single closed, non-self-intersecting outer loop of non-construction lines, winding counter-clockwise. */
export interface LineLoopProfile {
  readonly kind: 'line-loop';
  readonly pointIds: readonly string[];
  readonly lineIds: readonly string[];
}

/** A standalone non-construction circle used directly as a profile. */
export interface CircleProfile {
  readonly kind: 'circle';
  readonly circleId: string;
  readonly centerId: string;
  readonly radius: number;
}

/**
 * A single closed, non-self-intersecting loop mixing lines and arcs, wound
 * counter-clockwise. The authored arc topology is preserved (arcs are kept as
 * arcs, not flattened), so a consumer decides its own tessellation density.
 */
export interface CurveLoopProfile {
  readonly kind: 'curve-loop';
  readonly edges: readonly OrientedCurveEdge[];
}

export type SketchProfile = LineLoopProfile | CircleProfile | CurveLoopProfile;

export type ProfileResult =
  | { readonly ok: true; readonly profile: SketchProfile }
  | { readonly ok: false; readonly issues: readonly TopologyIssue[] };

function issue(kind: TopologyIssue['kind'], message: string, entityIds: readonly string[] = []): TopologyIssue {
  return { kind, message, entityIds };
}

/** Twice the polygon's signed area (shoelace formula); positive for counter-clockwise winding. */
function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/**
 * Normalizes a resolved loop to counter-clockwise winding. Reversing keeps
 * `pointIds[0]` as the anchor and reverses the rest, which — because
 * `lineIds[i]` connects `pointIds[i]` to `pointIds[i + 1]` — is exactly
 * undone by simply reversing `lineIds` too (see topology.test.ts for the
 * index algebra this relies on).
 */
function normalizeWinding(entities: readonly SketchEntity[], loop: ClosedLineLoop): LineLoopProfile {
  const index = indexSketchEntities(entities);
  const points: Vec2[] = loop.pointIds.map((id) => {
    const point = index.points.get(id)!;
    return [point.x, point.y];
  });

  if (signedArea(points) >= 0) {
    return { kind: 'line-loop', pointIds: loop.pointIds, lineIds: loop.lineIds };
  }
  return {
    kind: 'line-loop',
    pointIds: [loop.pointIds[0]!, ...loop.pointIds.slice(1).reverse()],
    lineIds: [...loop.lineIds].reverse(),
  };
}

function buildLoopSegments(entities: readonly SketchEntity[], loop: ClosedLineLoop): LoopSegment[] {
  const index = indexSketchEntities(entities);
  return loop.lineIds.map((lineId, i) => {
    const startId = loop.pointIds[i]!;
    const endId = loop.pointIds[(i + 1) % loop.pointIds.length]!;
    const start = index.points.get(startId)!;
    const end = index.points.get(endId)!;
    return { lineId, a: [start.x, start.y] as Vec2, b: [end.x, end.y] as Vec2 };
  });
}

/**
 * Detects the single supported closed profile in a sketch: one non-branching,
 * non-self-intersecting loop of non-construction lines, or one standalone
 * non-construction circle. Construction geometry is always excluded.
 * Returns structured diagnostics rather than throwing when the sketch cannot
 * be resolved to exactly one profile.
 */
export function detectSketchProfile(sketch: SketchFeature): ProfileResult {
  const entities = sketch.entities.filter((entity) => !entity.construction);
  const lines = entities.filter((entity): entity is Extract<SketchEntity, { kind: 'line' }> => entity.kind === 'line');
  const circles = entities.filter((entity): entity is Extract<SketchEntity, { kind: 'circle' }> => entity.kind === 'circle');
  const arcs = entities.filter((entity): entity is Extract<SketchEntity, { kind: 'arc' }> => entity.kind === 'arc');

  // A loop containing any arc is resolved by the curve-aware topology (endpoint
  // tolerance matching), which supports connected mixes of lines and arcs —
  // D-shapes, semicircles, slots, and multi-arc loops.
  if (arcs.length > 0) {
    if (circles.length > 0) {
      return {
        ok: false,
        issues: [
          issue(
            'disconnected',
            'Sketch contains both a line/arc chain and standalone circle(s); only one profile is supported.',
            [...arcs.map((a) => a.id), ...lines.map((l) => l.id), ...circles.map((c) => c.id)],
          ),
        ],
      };
    }

    const topology = analyzeCurveLoopTopology(entities);
    if (!topology.ok) return { ok: false, issues: topology.issues };

    const segments: CurveLoopSegment[] = topology.loop.edges.map((edge) =>
      edge.kind === 'arc'
        ? { id: edge.id, kind: 'arc', a: edge.start, b: edge.end, arc: edge.arc! }
        : { id: edge.id, kind: 'line', a: edge.start, b: edge.end },
    );
    const intersections = findCurveLoopIntersections(segments);
    if (intersections.length > 0) {
      const entityIds = [...new Set(intersections.flatMap((s) => [s.lineIdA, s.lineIdB]))];
      return { ok: false, issues: [issue('self-intersection', 'Profile edges cross or overlap.', entityIds)] };
    }

    return { ok: true, profile: { kind: 'curve-loop', edges: topology.loop.edges } };
  }

  if (lines.length > 0) {
    if (circles.length > 0) {
      return {
        ok: false,
        issues: [
          issue(
            'disconnected',
            'Sketch contains both a line chain and standalone circle(s); only one profile is supported.',
            [...lines.map((l) => l.id), ...circles.map((c) => c.id)],
          ),
        ],
      };
    }

    const topologyResult = analyzeLineLoopTopology(entities);
    if (!topologyResult.ok) return { ok: false, issues: topologyResult.issues };

    const segments = buildLoopSegments(entities, topologyResult.loop);
    const selfIntersections = findLoopSelfIntersections(segments);
    if (selfIntersections.length > 0) {
      const entityIds = [...new Set(selfIntersections.flatMap((s) => [s.lineIdA, s.lineIdB]))];
      return { ok: false, issues: [issue('self-intersection', 'Profile edges cross or overlap.', entityIds)] };
    }

    return { ok: true, profile: normalizeWinding(entities, topologyResult.loop) };
  }

  if (circles.length === 1) {
    const circle = circles[0]!;
    const index = indexSketchEntities(entities);
    if (!index.points.has(circle.centerId)) {
      return {
        ok: false,
        issues: [
          issue('missing-reference', `Circle ${circle.id} references missing center point ${circle.centerId}.`, [
            circle.id,
            circle.centerId,
          ]),
        ],
      };
    }
    return { ok: true, profile: { kind: 'circle', circleId: circle.id, centerId: circle.centerId, radius: circle.radius } };
  }

  if (circles.length > 1) {
    return {
      ok: false,
      issues: [
        issue(
          'disconnected',
          'Sketch contains multiple standalone circles; only one profile is supported.',
          circles.map((c) => c.id),
        ),
      ],
    };
  }

  return { ok: false, issues: [issue('disconnected', 'Sketch contains no non-construction profile geometry.')] };
}
