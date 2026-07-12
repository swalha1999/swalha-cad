import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';

/** Every entity id a constraint depends on, so a constraint can be dropped when any is removed. */
function constraintRefs(constraint: SketchConstraint): string[] {
  switch (constraint.kind) {
    case 'coincident':
    case 'distance':
      return [constraint.pointA, constraint.pointB];
    case 'horizontal':
    case 'vertical':
      return [constraint.lineId];
    case 'radius':
      return [constraint.circleId];
    case 'angle':
      return [constraint.lineA, constraint.lineB];
  }
}

/** Every entity id an entity depends on (a line on its endpoints, a circle/arc on its center). */
function entityRefs(entity: SketchEntity): string[] {
  if (entity.kind === 'line') return [entity.startId, entity.endId];
  if (entity.kind === 'circle' || entity.kind === 'arc') return [entity.centerId];
  return [];
}

/**
 * Removes the given sketch entities and everything that can no longer stand
 * without them, returning the surviving entities and constraints. Deletion
 * cascades along references: deleting a point drops the lines/circles that use
 * it (whose own constraints then go too), and any constraint that references a
 * removed entity is cleaned up. Pure — the input sketch is never mutated — so
 * the caller can wrap the result in a single undoable `feature.update`.
 */
export function removeSketchEntities(
  sketch: SketchFeature,
  ids: readonly string[],
): { entities: SketchEntity[]; constraints: SketchConstraint[] } {
  const removed = new Set(ids.filter((id) => sketch.entities.some((entity) => entity.id === id)));

  // Fixpoint: keep dropping entities whose references were themselves removed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of sketch.entities) {
      if (removed.has(entity.id)) continue;
      if (entityRefs(entity).some((ref) => removed.has(ref))) {
        removed.add(entity.id);
        changed = true;
      }
    }
  }

  return {
    entities: sketch.entities.filter((entity) => !removed.has(entity.id)),
    constraints: sketch.constraints.filter((constraint) => !constraintRefs(constraint).some((ref) => removed.has(ref))),
  };
}
