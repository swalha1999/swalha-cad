import type { SketchEntity } from '@swalha-cad/document';
import { arcEndpoints, signedArcSweep, type ArcGeometry } from './arc.js';
import { arcMidpoint, pointsClose, sampleArcEdge } from './curves.js';
import type { Vec2 } from './plane.js';
import { indexSketchEntities, type TopologyIssue } from './topology.js';

/**
 * Curve-aware loop topology: validates that a sketch's non-construction lines and
 * arcs form exactly one closed, non-branching, non-self-touching loop and returns
 * it as an ordered ring of oriented curve edges. Unlike the line-only
 * `analyzeLineLoopTopology`, arcs carry no shared endpoint point-ids — their
 * endpoints are *derived* from a centre/radius/angles — so connectivity is
 * resolved by fusing endpoints that coincide within {@link ENDPOINT_TOLERANCE}
 * rather than by matching point ids. The traversal and winding are normalized so
 * the result is identical regardless of input order or authored winding, and the
 * authored arc geometry is preserved (never flattened to line segments here).
 */

/** One curve edge of a resolved loop, oriented in traversal order (`end` of edge i joins `start` of edge i+1). */
export interface OrientedCurveEdge {
  readonly id: string;
  readonly kind: 'line' | 'arc';
  readonly start: Vec2;
  readonly end: Vec2;
  /** Present for arc edges: the authored arc geometry, sampled by consumers from `start` toward `end`. */
  readonly arc?: ArcGeometry;
}

/** A single closed ring of oriented line/arc edges, wound counter-clockwise and canonically anchored. */
export interface ClosedCurveLoop {
  readonly edges: readonly OrientedCurveEdge[];
}

export type CurveLoopTopologyResult =
  | { readonly ok: true; readonly loop: ClosedCurveLoop }
  | { readonly ok: false; readonly issues: readonly TopologyIssue[] };

function issue(kind: TopologyIssue['kind'], message: string, entityIds: readonly string[]): TopologyIssue {
  return { kind, message, entityIds };
}

interface ResolvedCurve {
  readonly id: string;
  readonly kind: 'line' | 'arc';
  /** Undirected endpoints in authored order (a line's start/end; an arc's derived start/end). */
  readonly start: Vec2;
  readonly end: Vec2;
  /** A stable interior sample used to tell a curve apart from a duplicate/reversed duplicate. */
  readonly mid: Vec2;
  readonly arc?: ArcGeometry;
}

/** Resolves non-construction lines/arcs into undirected curves, collecting per-entity degeneracy diagnostics. */
function resolveCurves(entities: readonly SketchEntity[]): { curves: ResolvedCurve[]; issues: TopologyIssue[] } {
  const index = indexSketchEntities(entities);
  const curves: ResolvedCurve[] = [];
  const issues: TopologyIssue[] = [];

  for (const entity of entities) {
    if (entity.construction) continue;

    if (entity.kind === 'line') {
      const start = index.points.get(entity.startId);
      const end = index.points.get(entity.endId);
      const missing = [!start ? entity.startId : null, !end ? entity.endId : null].filter((v): v is string => v !== null);
      if (missing.length > 0) {
        issues.push(issue('missing-reference', `Line ${entity.id} references missing point(s): ${missing.join(', ')}.`, [entity.id, ...missing]));
        continue;
      }
      const a: Vec2 = [start!.x, start!.y];
      const b: Vec2 = [end!.x, end!.y];
      curves.push({ id: entity.id, kind: 'line', start: a, end: b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
      continue;
    }

    if (entity.kind === 'arc') {
      const center = index.points.get(entity.centerId);
      if (!center) {
        issues.push(issue('missing-reference', `Arc ${entity.id} references missing center point ${entity.centerId}.`, [entity.id, entity.centerId]));
        continue;
      }
      const geometry: ArcGeometry = {
        center: [center.x, center.y],
        radius: entity.radius,
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
        direction: entity.direction,
      };
      if (!(geometry.radius > 0) || !Number.isFinite(geometry.radius) || Math.abs(signedArcSweep(geometry)) < 1e-9) {
        issues.push(issue('zero-sweep-arc', `Arc ${entity.id} has no finite angular sweep or radius.`, [entity.id]));
        continue;
      }
      const { start, end } = arcEndpoints(geometry);
      if (pointsClose(start, end)) {
        issues.push(issue('full-circle-arc', `Arc ${entity.id} is a full circle (coincident endpoints); represent it as a circle, not an arc.`, [entity.id]));
        continue;
      }
      curves.push({ id: entity.id, kind: 'arc', start, end, mid: arcMidpoint(geometry), arc: geometry });
      continue;
    }
  }

  return { curves, issues };
}

/** Compares two 2D points for a stable lexicographic sort/anchor order. */
function comparePoints(a: Vec2, b: Vec2): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

interface Cluster {
  rep: Vec2;
}

/**
 * Fuses all curve endpoints that coincide within {@link ENDPOINT_TOLERANCE} into
 * shared vertices. Endpoints are clustered in a fixed sorted order, so the same
 * geometry always yields the same clusters regardless of entity input order.
 */
function clusterEndpoints(curves: readonly ResolvedCurve[]): {
  clusters: Cluster[];
  startCluster: number[];
  endCluster: number[];
} {
  interface Endpoint {
    readonly curve: number;
    readonly which: 0 | 1;
    readonly pos: Vec2;
  }
  const endpoints: Endpoint[] = [];
  curves.forEach((curve, i) => {
    endpoints.push({ curve: i, which: 0, pos: curve.start });
    endpoints.push({ curve: i, which: 1, pos: curve.end });
  });
  endpoints.sort((a, b) => comparePoints(a.pos, b.pos));

  const clusters: Cluster[] = [];
  const startCluster = new Array<number>(curves.length).fill(-1);
  const endCluster = new Array<number>(curves.length).fill(-1);

  for (const endpoint of endpoints) {
    let clusterIndex = clusters.findIndex((c) => pointsClose(c.rep, endpoint.pos));
    if (clusterIndex === -1) {
      clusterIndex = clusters.length;
      clusters.push({ rep: endpoint.pos });
    }
    if (endpoint.which === 0) startCluster[endpoint.curve] = clusterIndex;
    else endCluster[endpoint.curve] = clusterIndex;
  }

  return { clusters, startCluster, endCluster };
}

/** Reports lines/arcs that duplicate another edge between the same two vertices (same curve, incl. reversed). */
function findDuplicates(
  curves: readonly ResolvedCurve[],
  startCluster: readonly number[],
  endCluster: readonly number[],
): TopologyIssue[] {
  const byPair = new Map<string, number[]>();
  curves.forEach((_, i) => {
    const key = [startCluster[i]!, endCluster[i]!].sort((a, b) => a - b).join('|');
    const list = byPair.get(key) ?? [];
    list.push(i);
    byPair.set(key, list);
  });

  const issues: TopologyIssue[] = [];
  for (const indices of byPair.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const ca = curves[indices[a]!]!;
        const cb = curves[indices[b]!]!;
        const coincident =
          ca.kind === cb.kind && (ca.kind === 'line' || pointsClose(ca.mid, cb.mid));
        if (coincident) {
          issues.push(issue('duplicate-edge', `Curves ${ca.id} and ${cb.id} are coincident duplicates.`, [ca.id, cb.id]));
        }
      }
    }
  }
  return issues;
}

interface AdjacencyEntry {
  readonly curve: number;
  readonly to: number;
}

/** Walks the connected, all-degree-2 component into an ordered oriented ring, starting at `anchorCluster`. */
function traverse(
  curves: readonly ResolvedCurve[],
  startCluster: readonly number[],
  endCluster: readonly number[],
  adjacency: ReadonlyMap<number, AdjacencyEntry[]>,
  anchorCluster: number,
): OrientedCurveEdge[] {
  const orient = (curveIndex: number, fromCluster: number): OrientedCurveEdge => {
    const curve = curves[curveIndex]!;
    const forward = startCluster[curveIndex] === fromCluster;
    const start = forward ? curve.start : curve.end;
    const end = forward ? curve.end : curve.start;
    return curve.kind === 'arc'
      ? { id: curve.id, kind: 'arc', start, end, arc: curve.arc! }
      : { id: curve.id, kind: 'line', start, end };
  };

  const incident = [...adjacency.get(anchorCluster)!].sort((a, b) => (curves[a.curve]!.id < curves[b.curve]!.id ? -1 : 1));
  const first = incident[0]!;

  const edges: OrientedCurveEdge[] = [orient(first.curve, anchorCluster)];
  const used = new Set<number>([first.curve]);
  let current = first.to;
  let previous = first.curve;

  while (current !== anchorCluster) {
    const next = adjacency.get(current)!.find((entry) => entry.curve !== previous && !used.has(entry.curve));
    if (!next) break;
    edges.push(orient(next.curve, current));
    used.add(next.curve);
    previous = next.curve;
    current = next.to;
  }

  return edges;
}

/** Twice the signed area of a closed polyline sampled from the loop's edges; positive for counter-clockwise. */
function sampledSignedArea(edges: readonly OrientedCurveEdge[]): number {
  const ring: Vec2[] = [];
  for (const edge of edges) {
    const points = edge.kind === 'arc' ? sampleArcEdge(edge.arc!, edge.start) : [edge.start, edge.end];
    for (let i = 0; i < points.length - 1; i++) ring.push(points[i]!);
  }
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/** Reverses a loop's traversal direction, swapping each edge's endpoints while keeping arc geometry intact. */
function reverseLoop(edges: readonly OrientedCurveEdge[]): OrientedCurveEdge[] {
  return [...edges].reverse().map((edge) =>
    edge.kind === 'arc'
      ? { id: edge.id, kind: 'arc', start: edge.end, end: edge.start, arc: edge.arc! }
      : { id: edge.id, kind: 'line', start: edge.end, end: edge.start },
  );
}

/** Rotates the loop so it begins at the edge whose start point is lexicographically smallest. */
function canonicalRotate(edges: readonly OrientedCurveEdge[]): OrientedCurveEdge[] {
  let best = 0;
  for (let i = 1; i < edges.length; i++) {
    if (comparePoints(edges[i]!.start, edges[best]!.start) < 0) best = i;
  }
  return [...edges.slice(best), ...edges.slice(0, best)];
}

export function analyzeCurveLoopTopology(entities: readonly SketchEntity[]): CurveLoopTopologyResult {
  const { curves, issues: resolveIssues } = resolveCurves(entities);
  if (resolveIssues.length > 0) return { ok: false, issues: resolveIssues };

  if (curves.length === 0) {
    return { ok: false, issues: [issue('disconnected', 'Sketch contains no line or arc edges to form a loop.', [])] };
  }

  const { clusters, startCluster, endCluster } = clusterEndpoints(curves);

  const zeroLength: TopologyIssue[] = [];
  curves.forEach((curve, i) => {
    if (curve.kind === 'line' && startCluster[i] === endCluster[i]) {
      zeroLength.push(issue('zero-length-edge', `Line ${curve.id} has zero length.`, [curve.id]));
    }
  });
  if (zeroLength.length > 0) return { ok: false, issues: zeroLength };

  const duplicates = findDuplicates(curves, startCluster, endCluster);
  if (duplicates.length > 0) return { ok: false, issues: duplicates };

  const adjacency = new Map<number, AdjacencyEntry[]>();
  const addEdge = (from: number, to: number, curve: number) => {
    const list = adjacency.get(from) ?? [];
    list.push({ curve, to });
    adjacency.set(from, list);
  };
  curves.forEach((_, i) => {
    addEdge(startCluster[i]!, endCluster[i]!, i);
    addEdge(endCluster[i]!, startCluster[i]!, i);
  });

  const branches: TopologyIssue[] = [];
  for (let c = 0; c < clusters.length; c++) {
    const degree = adjacency.get(c)?.length ?? 0;
    if (degree > 2) {
      const curveIds = adjacency.get(c)!.map((e) => curves[e.curve]!.id);
      branches.push(issue('branch', `A sketch vertex has ${degree} incident edges; a profile chain allows at most 2.`, curveIds));
    }
  }
  if (branches.length > 0) return { ok: false, issues: branches };

  // Connectivity: flood fill from cluster 0 over the adjacency graph.
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const { to } of adjacency.get(node) ?? []) {
      if (!visited.has(to)) {
        visited.add(to);
        queue.push(to);
      }
    }
  }
  if (visited.size < clusters.length) {
    return {
      ok: false,
      issues: [issue('disconnected', 'Sketch curves form more than one disconnected chain; a single profile is ambiguous.', curves.map((c) => c.id))],
    };
  }

  const openEnds: number[] = [];
  for (let c = 0; c < clusters.length; c++) {
    if ((adjacency.get(c)?.length ?? 0) === 1) openEnds.push(c);
  }
  if (openEnds.length > 0) {
    return { ok: false, issues: [issue('open-chain', 'Curve chain is not closed; it has dangling endpoints.', curves.map((c) => c.id))] };
  }

  // Deterministic anchor: the cluster whose representative point is smallest.
  let anchor = 0;
  for (let c = 1; c < clusters.length; c++) {
    if (comparePoints(clusters[c]!.rep, clusters[anchor]!.rep) < 0) anchor = c;
  }

  let edges = traverse(curves, startCluster, endCluster, adjacency, anchor);
  if (edges.length !== curves.length) {
    return { ok: false, issues: [issue('disconnected', 'Sketch curves do not form a single traversable loop.', curves.map((c) => c.id))] };
  }

  if (sampledSignedArea(edges) < 0) edges = reverseLoop(edges);
  edges = canonicalRotate(edges);

  return { ok: true, loop: { edges } };
}
