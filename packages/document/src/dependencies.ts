import type { CadCommand } from './commands.js';
import type { CadDocumentV2, CadFeature } from './types.js';

/** The object a deletion request targets: an M1 primitive entity or a document feature. */
export interface DeletionTarget {
  readonly kind: 'entity' | 'feature';
  readonly id: string;
}

/** A downstream feature that a deletion will also remove because it depends on the target. */
export interface DependentFeature {
  readonly id: string;
  readonly name: string;
}

/**
 * A fully-resolved, deterministic deletion plan. `command` performs the whole
 * deletion as one undoable transaction — a bare `entity.delete`/`feature.delete`
 * when nothing else is affected, or a `batch` that removes every downstream
 * dependent before the target when there are dependents. `dependents` drives the
 * impact/confirmation dialog; an empty list means the object deletes immediately.
 */
export interface DeletionPlan {
  readonly command: CadCommand;
  readonly targetKind: DeletionTarget['kind'];
  readonly targetId: string;
  readonly targetName: string;
  readonly dependents: readonly DependentFeature[];
}

/** Direct dependency: an extrude feature depends on the sketch named by its `sketchId`. */
function directDependents(features: readonly CadFeature[], featureId: string): CadFeature[] {
  return features.filter((feature) => feature.kind === 'extrude' && feature.sketchId === featureId);
}

/**
 * Transitive downstream features of a feature, in document order, each appearing
 * once. Generic over the dependency graph so a future deeper chain (a feature
 * built on an extrude) cascades correctly without special-casing.
 */
function transitiveDependents(features: readonly CadFeature[], featureId: string): CadFeature[] {
  const collected: CadFeature[] = [];
  const seen = new Set<string>([featureId]);
  const queue = [featureId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of directDependents(features, current)) {
      if (seen.has(dependent.id)) continue;
      seen.add(dependent.id);
      collected.push(dependent);
      queue.push(dependent.id);
    }
  }
  // Preserve document order for a stable, human-legible impact list.
  const order = new Map(features.map((feature, index) => [feature.id, index]));
  return collected.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function toCommand(commands: CadCommand[]): CadCommand {
  return commands.length === 1 ? (commands[0] as CadCommand) : { type: 'batch', commands };
}

/**
 * Computes the deletion plan for a target, resolving downstream dependents so the
 * caller can either delete immediately (no dependents) or confirm an atomic
 * cascade. Returns `null` when the target is not present in the document.
 */
export function planDeletion(document: CadDocumentV2, target: DeletionTarget): DeletionPlan | null {
  if (target.kind === 'entity') {
    const entity = document.entities.find((candidate) => candidate.id === target.id);
    if (!entity) return null;
    return {
      command: { type: 'entity.delete', id: entity.id },
      targetKind: 'entity',
      targetId: entity.id,
      targetName: entity.name,
      dependents: [],
    };
  }

  const feature = document.features.find((candidate) => candidate.id === target.id);
  if (!feature) return null;

  const dependents = transitiveDependents(document.features, feature.id);
  const commands: CadCommand[] = [
    ...dependents.map((dependent): CadCommand => ({ type: 'feature.delete', id: dependent.id })),
    { type: 'feature.delete', id: feature.id },
  ];

  return {
    command: toCommand(commands),
    targetKind: 'feature',
    targetId: feature.id,
    targetName: feature.name,
    dependents: dependents.map((dependent) => ({ id: dependent.id, name: dependent.name })),
  };
}
