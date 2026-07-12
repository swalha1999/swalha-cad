import type { SketchFeature } from '@swalha-cad/document';
import type { Vec2 } from './tools/types.js';

/**
 * The tangent direction with which a new arc should continue from `pointId`,
 * derived from a line ending at that point. When the point is a line's end, the
 * arc continues along the line's travel (end − start); when it is the start, it
 * continues outward (start − end). Returns the first incident non-construction
 * line's unit direction, or `null` when no line touches the point — the tangent
 * arc tool then has nothing to be tangent to. Pure and deterministic.
 */
export function lineTangentAtPoint(sketch: SketchFeature, pointId: string): Vec2 | null {
  const coords = new Map<string, { x: number; y: number }>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') coords.set(entity.id, { x: entity.x, y: entity.y });
  }
  for (const entity of sketch.entities) {
    if (entity.kind !== 'line' || entity.construction) continue;
    const isEnd = entity.endId === pointId;
    const isStart = entity.startId === pointId;
    if (!isEnd && !isStart) continue;
    const here = coords.get(pointId);
    const other = coords.get(isEnd ? entity.startId : entity.endId);
    if (!here || !other) continue;
    const dx = here.x - other.x;
    const dy = here.y - other.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    return { x: dx / length, y: dy / length };
  }
  return null;
}
