import type { SketchFeature } from '@swalha-cad/document';
import { buildConstraintForSelection } from './constraint-actions.js';

/**
 * A resolved point pair whose distance the Distance/Dimension tool will drive,
 * carrying the current measured length (mm) so the inline editor can prefill it.
 */
export interface AwaitingDimension {
  pointA: string;
  pointB: string;
  measured: number;
}

/**
 * The progression of the command-first picking phase: either still collecting
 * geometry (`picking`, 0–1 points so far) or a resolved pair ready for a value.
 */
export type DimensionPick =
  | { kind: 'picking'; points: string[] }
  | { kind: 'awaiting'; dimension: AwaitingDimension };

interface Vec2 {
  x: number;
  y: number;
}

function pointPositions(sketch: SketchFeature): Map<string, Vec2> {
  const map = new Map<string, Vec2>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') map.set(entity.id, { x: entity.x, y: entity.y });
  }
  return map;
}

/** The ordered `[startId, endId]` of a line entity, or `null` when the id is not a line. */
export function lineEndpoints(sketch: SketchFeature, lineId: string): [string, string] | null {
  const entity = sketch.entities.find((candidate) => candidate.id === lineId);
  return entity && entity.kind === 'line' ? [entity.startId, entity.endId] : null;
}

/** The current Euclidean distance (mm) between two points, or `null` when either is missing. */
export function measureDistance(sketch: SketchFeature, a: string, b: string): number | null {
  const points = pointPositions(sketch);
  const pa = points.get(a);
  const pb = points.get(b);
  if (!pa || !pb) return null;
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/**
 * Resolves a distance-eligible selection (exactly one line, or exactly two
 * points) to the awaiting dimension, reusing the shared constraint-selection
 * logic so the measured value stays consistent with the constraint toolbar.
 * Returns `null` for any other selection or a degenerate (zero-length) pair.
 */
export function resolveFromSelection(sketch: SketchFeature, selection: readonly string[]): AwaitingDimension | null {
  const constraint = buildConstraintForSelection(sketch, selection, 'distance');
  if (!constraint || constraint.kind !== 'distance') return null;
  return { pointA: constraint.pointA, pointB: constraint.pointB, measured: constraint.value };
}

/**
 * Advances the picking phase with a clicked entity id. A line resolves
 * immediately to its endpoints; points accumulate until a second distinct one
 * completes the pair. Returns `null` (ignore the click) for ids outside the
 * sketch, a repeated point, or a degenerate resolved pair.
 */
export function pickForDimension(sketch: SketchFeature, points: readonly string[], id: string): DimensionPick | null {
  const endpoints = lineEndpoints(sketch, id);
  if (endpoints) {
    const measured = measureDistance(sketch, endpoints[0], endpoints[1]);
    if (measured === null || measured <= 0) return null;
    return { kind: 'awaiting', dimension: { pointA: endpoints[0], pointB: endpoints[1], measured } };
  }

  const point = sketch.entities.find((candidate) => candidate.id === id && candidate.kind === 'point');
  if (!point) return null;
  if (points.includes(id)) return { kind: 'picking', points: [...points] };

  const next = [...points, id];
  if (next.length < 2) return { kind: 'picking', points: next };

  const [pointA, pointB] = next;
  const measured = measureDistance(sketch, pointA!, pointB!);
  if (measured === null || measured <= 0) return null;
  return { kind: 'awaiting', dimension: { pointA: pointA!, pointB: pointB!, measured } };
}

/** Plane-space geometry for the live dimension annotation: the measured points, an offset dimension line, and its label anchor. */
export interface DimensionAnnotation {
  a: Vec2;
  b: Vec2;
  aOff: Vec2;
  bOff: Vec2;
  mid: Vec2;
}

/**
 * Builds the annotation geometry for a dimension between two points: the
 * dimension line is offset perpendicular to the measured segment by `offsetMm`
 * so witness lines can run from each point to it, and `mid` anchors the value
 * label. Returns `null` when a point is missing or the segment is degenerate.
 */
export function dimensionAnnotation(
  sketch: SketchFeature,
  pair: { pointA: string; pointB: string },
  offsetMm: number,
): DimensionAnnotation | null {
  const points = pointPositions(sketch);
  const a = points.get(pair.pointA);
  const b = points.get(pair.pointB);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  // Unit perpendicular (rotate the segment direction +90°).
  const nx = -dy / length;
  const ny = dx / length;
  const aOff = { x: a.x + nx * offsetMm, y: a.y + ny * offsetMm };
  const bOff = { x: b.x + nx * offsetMm, y: b.y + ny * offsetMm };
  const mid = { x: (aOff.x + bOff.x) / 2, y: (aOff.y + bOff.y) / 2 };
  return { a, b, aOff, bOff, mid };
}
