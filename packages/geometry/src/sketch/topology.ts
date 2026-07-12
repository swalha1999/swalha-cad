import type { SketchEntity } from '@swalha-cad/document';

export type SketchPointEntity = Extract<SketchEntity, { kind: 'point' }>;
export type SketchLineEntity = Extract<SketchEntity, { kind: 'line' }>;
export type SketchCircleEntity = Extract<SketchEntity, { kind: 'circle' }>;

/** Id-keyed lookup into a sketch's entities, split by kind. */
export interface SketchEntityIndex {
  readonly points: ReadonlyMap<string, SketchPointEntity>;
  readonly lines: ReadonlyMap<string, SketchLineEntity>;
  readonly circles: ReadonlyMap<string, SketchCircleEntity>;
}

/** Builds an id-keyed lookup over a sketch's entities. Later entities with a repeated id overwrite earlier ones. */
export function indexSketchEntities(entities: readonly SketchEntity[]): SketchEntityIndex {
  const points = new Map<string, SketchPointEntity>();
  const lines = new Map<string, SketchLineEntity>();
  const circles = new Map<string, SketchCircleEntity>();
  for (const entity of entities) {
    if (entity.kind === 'point') points.set(entity.id, entity);
    else if (entity.kind === 'line') lines.set(entity.id, entity);
    else if (entity.kind === 'circle') circles.set(entity.id, entity);
  }
  return { points, lines, circles };
}

export type TopologyIssueKind =
  | 'missing-reference'
  | 'zero-length-edge'
  | 'duplicate-edge'
  | 'branch'
  | 'open-chain'
  | 'disconnected'
  | 'self-intersection'
  /** An arc whose two endpoints coincide, so it represents a full circle and cannot join a chain unambiguously. */
  | 'full-circle-arc'
  /** An arc with no (or non-finite) angular sweep or radius: a degenerate edge that cannot be traversed. */
  | 'zero-sweep-arc'
  /** A non-construction arc is present but arc profiles are not yet supported by extrusion (legacy; no longer emitted for supported closed loops). */
  | 'unsupported-arc';

/** A structured diagnostic describing why a sketch's topology could not be resolved into a profile. */
export interface TopologyIssue {
  readonly kind: TopologyIssueKind;
  readonly message: string;
  readonly entityIds: readonly string[];
}

/** A single closed, non-branching chain of lines: `lineIds[i]` connects `pointIds[i]` to `pointIds[(i + 1) % n]`. */
export interface ClosedLineLoop {
  readonly pointIds: readonly string[];
  readonly lineIds: readonly string[];
}

export type LineLoopTopologyResult =
  | { readonly ok: true; readonly loop: ClosedLineLoop }
  | { readonly ok: false; readonly issues: readonly TopologyIssue[] };

interface ResolvedLine {
  readonly id: string;
  readonly start: SketchPointEntity;
  readonly end: SketchPointEntity;
}

function resolveLines(
  index: SketchEntityIndex,
  lines: readonly SketchLineEntity[],
): { resolved: ResolvedLine[]; issues: TopologyIssue[] } {
  const issues: TopologyIssue[] = [];
  const resolved: ResolvedLine[] = [];
  for (const line of lines) {
    const start = index.points.get(line.startId);
    const end = index.points.get(line.endId);
    const missingIds: string[] = [];
    if (!start) missingIds.push(line.startId);
    if (!end) missingIds.push(line.endId);
    if (missingIds.length > 0) {
      issues.push({
        kind: 'missing-reference',
        message: `Line ${line.id} references missing point(s): ${missingIds.join(', ')}.`,
        entityIds: [line.id, ...missingIds],
      });
      continue;
    }
    resolved.push({ id: line.id, start: start!, end: end! });
  }
  return { resolved, issues };
}

function findZeroLengthEdges(resolved: readonly ResolvedLine[]): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  for (const line of resolved) {
    const samePoint = line.start.id === line.end.id;
    const sameCoords = line.start.x === line.end.x && line.start.y === line.end.y;
    if (samePoint || sameCoords) {
      issues.push({
        kind: 'zero-length-edge',
        message: `Line ${line.id} has zero length.`,
        entityIds: [line.id, line.start.id, line.end.id],
      });
    }
  }
  return issues;
}

function findDuplicateEdges(resolved: readonly ResolvedLine[]): TopologyIssue[] {
  const byKey = new Map<string, string[]>();
  for (const line of resolved) {
    const key = [line.start.id, line.end.id].sort().join('|');
    const list = byKey.get(key) ?? [];
    list.push(line.id);
    byKey.set(key, list);
  }
  const issues: TopologyIssue[] = [];
  for (const [key, lineIds] of byKey) {
    if (lineIds.length > 1) {
      const [a, b] = key.split('|') as [string, string];
      issues.push({
        kind: 'duplicate-edge',
        message: `Points ${a} and ${b} are connected by duplicate edges: ${lineIds.join(', ')}.`,
        entityIds: [...lineIds],
      });
    }
  }
  return issues;
}

interface AdjacencyEntry {
  readonly lineId: string;
  readonly otherId: string;
}

function buildAdjacency(resolved: readonly ResolvedLine[]): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();
  const addEdge = (from: string, to: string, lineId: string) => {
    const list = adjacency.get(from) ?? [];
    list.push({ lineId, otherId: to });
    adjacency.set(from, list);
  };
  for (const line of resolved) {
    addEdge(line.start.id, line.end.id, line.id);
    addEdge(line.end.id, line.start.id, line.id);
  }
  return adjacency;
}

function findBranches(adjacency: ReadonlyMap<string, AdjacencyEntry[]>): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  for (const id of [...adjacency.keys()].sort()) {
    const neighbors = adjacency.get(id)!;
    if (neighbors.length > 2) {
      issues.push({
        kind: 'branch',
        message: `Point ${id} has ${neighbors.length} connected edges; a profile chain allows at most 2.`,
        entityIds: [id, ...neighbors.map((n) => n.lineId)],
      });
    }
  }
  return issues;
}

function findComponents(adjacency: ReadonlyMap<string, AdjacencyEntry[]>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    const component: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const { otherId } of adjacency.get(current) ?? []) {
        if (!visited.has(otherId)) {
          visited.add(otherId);
          queue.push(otherId);
        }
      }
    }
    components.push(component.sort());
  }
  return components;
}

/**
 * Walks a single closed component (every point already known to have degree
 * 2) into an ordered loop. Starts at the lexicographically smallest point id
 * and takes the lexicographically smallest neighbor first, so the result is
 * identical regardless of input line order or individual line direction.
 */
function traverseLoop(adjacency: ReadonlyMap<string, AdjacencyEntry[]>, component: readonly string[]): ClosedLineLoop {
  const start = component[0]!;
  const neighbors = [...adjacency.get(start)!].sort((a, b) => (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0));
  const first = neighbors[0]!;

  const pointIds: string[] = [start];
  const lineIds: string[] = [first.lineId];
  let previous = start;
  let current = first.otherId;

  while (current !== start) {
    pointIds.push(current);
    const next = adjacency.get(current)!.find((entry) => entry.otherId !== previous)!;
    lineIds.push(next.lineId);
    previous = current;
    current = next.otherId;
  }

  return { pointIds, lineIds };
}

/**
 * Validates that a sketch's non-construction lines form exactly one closed,
 * non-branching loop, returning structured diagnostics otherwise. Ignores
 * circles entirely; a caller composing full profile detection (see
 * `profile.ts`) decides how lines and circles interact.
 */
export function analyzeLineLoopTopology(entities: readonly SketchEntity[]): LineLoopTopologyResult {
  const index = indexSketchEntities(entities);
  const nonConstructionLines = [...index.lines.values()].filter((line) => !line.construction);

  const { resolved, issues: missingIssues } = resolveLines(index, nonConstructionLines);
  if (missingIssues.length > 0) return { ok: false, issues: missingIssues };

  const zeroLengthIssues = findZeroLengthEdges(resolved);
  if (zeroLengthIssues.length > 0) return { ok: false, issues: zeroLengthIssues };

  const duplicateIssues = findDuplicateEdges(resolved);
  if (duplicateIssues.length > 0) return { ok: false, issues: duplicateIssues };

  const adjacency = buildAdjacency(resolved);
  if (adjacency.size === 0) {
    return {
      ok: false,
      issues: [{ kind: 'disconnected', message: 'Sketch contains no line edges to form a loop.', entityIds: [] }],
    };
  }

  const branchIssues = findBranches(adjacency);
  if (branchIssues.length > 0) return { ok: false, issues: branchIssues };

  const components = findComponents(adjacency);
  if (components.length > 1) {
    return {
      ok: false,
      issues: [
        {
          kind: 'disconnected',
          message: `Sketch lines form ${components.length} disconnected chains; a single profile is ambiguous.`,
          entityIds: components.flat(),
        },
      ],
    };
  }

  const component = components[0]!;
  const openEnds = component.filter((id) => adjacency.get(id)!.length === 1);
  if (openEnds.length > 0) {
    return {
      ok: false,
      issues: [
        {
          kind: 'open-chain',
          message: `Line chain is not closed; open at: ${openEnds.join(', ')}.`,
          entityIds: openEnds,
        },
      ],
    };
  }

  return { ok: true, loop: traverseLoop(adjacency, component) };
}
