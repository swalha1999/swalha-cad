import type { SketchEntity, SketchFeature } from '@swalha-cad/document';

/**
 * Flips the construction flag on the selected sketch entities. The whole
 * selection moves to a single target state: it becomes real geometry only when
 * every selected entity is already construction, otherwise it all becomes
 * construction (matching Onshape's toggle semantics on a mixed selection).
 * Construction geometry stays fully selectable/constrainable — it is only
 * excluded from profile/extrude detection (see `detectSketchProfile`). Returns
 * the original entities array unchanged when the selection matches nothing.
 */
export function applyConstructionToggle(sketch: SketchFeature, ids: readonly string[]): SketchEntity[] {
  const idSet = new Set(ids);
  const selected = sketch.entities.filter((entity) => idSet.has(entity.id));
  if (selected.length === 0) return sketch.entities;
  const target = !selected.every((entity) => entity.construction);
  return sketch.entities.map((entity) => (idSet.has(entity.id) ? { ...entity, construction: target } : entity));
}
