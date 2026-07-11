import type { SnapResult, Vec2 } from './tools/types.js';

export interface ExistingPoint {
  id: string;
  x: number;
  y: number;
}

export interface SnapOptions {
  /** Grid spacing in mm; a raw position off any existing point rounds to the nearest node. */
  gridSize: number;
  /** Snap radius in mm around existing points; the nearest within this wins. */
  pointSnapDistance: number;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Resolves a raw plane-local cursor position to a committable {@link SnapResult}.
 * An existing point within `pointSnapDistance` takes priority (so new geometry
 * becomes coincident with it); otherwise the position snaps to the nearest grid
 * node. Deterministic: ties resolve to the earliest existing point.
 */
export function resolveSnap(raw: Vec2, points: readonly ExistingPoint[], options: SnapOptions): SnapResult {
  let nearest: ExistingPoint | null = null;
  let nearestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - raw.x, point.y - raw.y);
    if (distance <= options.pointSnapDistance && distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  if (nearest) {
    return { point: { x: nearest.x, y: nearest.y }, ref: { kind: 'existing', id: nearest.id }, kind: 'point' };
  }

  const x = roundTo(raw.x, options.gridSize);
  const y = roundTo(raw.y, options.gridSize);
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}
