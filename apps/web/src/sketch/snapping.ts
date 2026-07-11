import type { SnapSettings } from './snap-settings.js';
import type { PointRef, SnapKind, SnapResult, Vec2 } from './tools/types.js';

/** An existing sketch point that new geometry can snap onto (becoming coincident by id). */
export interface SnapPoint {
  id: string;
  x: number;
  y: number;
}

/** An existing line segment, in plane-local coordinates, for midpoint/intersection snaps. */
export interface SnapLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** An existing circle center (a point entity) for center snaps. */
export interface SnapCircleCenter {
  id: string;
  x: number;
  y: number;
}

/** The committed geometry the cursor can snap against, projected to the sketch plane. */
export interface SnapContext {
  points: readonly SnapPoint[];
  lines: readonly SnapLine[];
  centers: readonly SnapCircleCenter[];
}

export interface SnapConfig {
  /** Grid spacing in mm used only when grid snapping is enabled. */
  gridSize: number;
  /** Radius in mm within which a target captures the cursor. */
  snapDistance: number;
}

interface Candidate {
  point: Vec2;
  ref: PointRef;
  kind: SnapKind;
  distance: number;
  /** Lower wins when two candidates are equidistant; a fixed per-kind priority. */
  rank: number;
}

/**
 * Strong object-snap priority for deterministic tie-breaking. When two targets
 * are the same distance from the cursor, the smaller rank wins (endpoint beats a
 * coincident center, an intersection beats the origin, and so on).
 */
const STRONG_RANK: Record<string, number> = {
  endpoint: 0,
  center: 1,
  intersection: 2,
  midpoint: 3,
  origin: 4,
};

function distanceTo(raw: Vec2, x: number, y: number): number {
  return Math.hypot(raw.x - x, raw.y - y);
}

function newRef(x: number, y: number): PointRef {
  return { kind: 'new', x, y };
}

/** A stable string so equal (distance, rank) candidates still order deterministically. */
function tiebreak(candidate: Candidate): string {
  return candidate.ref.kind === 'existing'
    ? `e:${candidate.ref.id}`
    : `n:${candidate.point.x},${candidate.point.y}`;
}

/** Picks the nearest candidate, breaking ties by rank then a stable key. Deterministic. */
function best(candidates: Candidate[]): Candidate | null {
  let winner: Candidate | null = null;
  for (const candidate of candidates) {
    if (
      winner === null ||
      candidate.distance < winner.distance ||
      (candidate.distance === winner.distance && candidate.rank < winner.rank) ||
      (candidate.distance === winner.distance && candidate.rank === winner.rank && tiebreak(candidate) < tiebreak(winner))
    ) {
      winner = candidate;
    }
  }
  return winner;
}

function toResult(candidate: Candidate): SnapResult {
  return { point: candidate.point, ref: candidate.ref, kind: candidate.kind };
}

/** Intersection point of two segments if they properly cross within both, else `null`. */
function segmentIntersection(a: SnapLine, b: SnapLine): Vec2 | null {
  const r = { x: a.bx - a.ax, y: a.by - a.ay };
  const s = { x: b.bx - b.ax, y: b.by - b.ay };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null; // parallel or degenerate
  const qp = { x: b.ax - a.ax, y: b.ay - a.ay };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.ax + t * r.x, y: a.ay + t * r.y };
}

/** Collects every enabled strong object-snap candidate within the snap distance. */
function strongCandidates(raw: Vec2, context: SnapContext, settings: SnapSettings, config: SnapConfig): Candidate[] {
  const candidates: Candidate[] = [];
  const within = (distance: number): boolean => distance <= config.snapDistance;

  if (settings.endpoint) {
    for (const point of context.points) {
      const distance = distanceTo(raw, point.x, point.y);
      if (within(distance)) {
        candidates.push({ point: { x: point.x, y: point.y }, ref: { kind: 'existing', id: point.id }, kind: 'endpoint', distance, rank: STRONG_RANK.endpoint! });
      }
    }
  }

  if (settings.center) {
    for (const center of context.centers) {
      const distance = distanceTo(raw, center.x, center.y);
      if (within(distance)) {
        candidates.push({ point: { x: center.x, y: center.y }, ref: { kind: 'existing', id: center.id }, kind: 'center', distance, rank: STRONG_RANK.center! });
      }
    }
  }

  if (settings.midpoint) {
    for (const line of context.lines) {
      const mx = (line.ax + line.bx) / 2;
      const my = (line.ay + line.by) / 2;
      const distance = distanceTo(raw, mx, my);
      if (within(distance)) {
        candidates.push({ point: { x: mx, y: my }, ref: newRef(mx, my), kind: 'midpoint', distance, rank: STRONG_RANK.midpoint! });
      }
    }
  }

  if (settings.intersection) {
    for (let i = 0; i < context.lines.length; i++) {
      for (let j = i + 1; j < context.lines.length; j++) {
        const hit = segmentIntersection(context.lines[i]!, context.lines[j]!);
        if (!hit) continue;
        const distance = distanceTo(raw, hit.x, hit.y);
        if (within(distance)) {
          candidates.push({ point: hit, ref: newRef(hit.x, hit.y), kind: 'intersection', distance, rank: STRONG_RANK.intersection! });
        }
      }
    }
  }

  if (settings.origin) {
    const distance = distanceTo(raw, 0, 0);
    if (within(distance)) {
      candidates.push({ point: { x: 0, y: 0 }, ref: newRef(0, 0), kind: 'origin', distance, rank: STRONG_RANK.origin! });
    }
  }

  return candidates;
}

/** Collects horizontal/vertical alignment inferences with existing points. */
function inferenceCandidates(raw: Vec2, context: SnapContext, config: SnapConfig): Candidate[] {
  const candidates: Candidate[] = [];
  for (const point of context.points) {
    const dy = Math.abs(raw.y - point.y);
    if (dy <= config.snapDistance) {
      candidates.push({ point: { x: raw.x, y: point.y }, ref: newRef(raw.x, point.y), kind: 'horizontal', distance: dy, rank: 0 });
    }
    const dx = Math.abs(raw.x - point.x);
    if (dx <= config.snapDistance) {
      candidates.push({ point: { x: point.x, y: raw.y }, ref: newRef(point.x, raw.y), kind: 'vertical', distance: dx, rank: 1 });
    }
  }
  return candidates;
}

/**
 * Resolves a raw plane-local cursor position to a committable {@link SnapResult}
 * without ever quantizing coordinates unless the user asks for it.
 *
 * Priority is tiered and deterministic: enabled strong object snaps (endpoint,
 * center, intersection, midpoint, origin) win first — nearest, ties broken by a
 * fixed per-kind priority; then horizontal/vertical inference; then grid
 * snapping if enabled; otherwise the exact continuous coordinate under the cursor
 * is kept (`kind: 'free'`). Holding the bypass modifier suppresses every snap so
 * geometry can be placed at any floating-point coordinate.
 */
export function resolveSnap(
  raw: Vec2,
  context: SnapContext,
  settings: SnapSettings,
  config: SnapConfig,
  bypass: boolean,
): SnapResult {
  if (bypass) {
    return { point: { x: raw.x, y: raw.y }, ref: newRef(raw.x, raw.y), kind: 'free' };
  }

  const strong = best(strongCandidates(raw, context, settings, config));
  if (strong) return toResult(strong);

  if (settings.horizontalVertical) {
    const inferred = best(inferenceCandidates(raw, context, config));
    if (inferred) return toResult(inferred);
  }

  if (settings.grid) {
    const x = Math.round(raw.x / config.gridSize) * config.gridSize;
    const y = Math.round(raw.y / config.gridSize) * config.gridSize;
    return { point: { x, y }, ref: newRef(x, y), kind: 'grid' };
  }

  return { point: { x: raw.x, y: raw.y }, ref: newRef(raw.x, raw.y), kind: 'free' };
}
