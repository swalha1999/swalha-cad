import type { CadCommand } from './commands.js';
import type { CadDocumentV2 } from './types.js';

/** Thrown when a command references an entity id that is not present in the document. */
export class UnknownEntityError extends Error {
  readonly entityId: string;

  constructor(entityId: string) {
    super(`Unknown entity: ${entityId}`);
    this.name = 'UnknownEntityError';
    this.entityId = entityId;
  }
}

/** Thrown when a command references a feature id that is not present in the document. */
export class UnknownFeatureError extends Error {
  readonly featureId: string;

  constructor(featureId: string) {
    super(`Unknown feature: ${featureId}`);
    this.name = 'UnknownFeatureError';
    this.featureId = featureId;
  }
}

/** Deterministic, side-effect-free application of a command to a document, producing a new document. */
export function applyCommand(document: CadDocumentV2, command: CadCommand): CadDocumentV2 {
  switch (command.type) {
    case 'entity.create':
      return { ...document, entities: [...document.entities, command.entity] };

    case 'entity.update': {
      const existing = document.entities.find((entity) => entity.id === command.id);
      if (!existing) {
        throw new UnknownEntityError(command.id);
      }
      const updated = { ...existing, ...command.patch };
      return {
        ...document,
        entities: document.entities.map((entity) => (entity.id === command.id ? updated : entity)),
      };
    }

    case 'entity.delete': {
      const exists = document.entities.some((entity) => entity.id === command.id);
      if (!exists) {
        throw new UnknownEntityError(command.id);
      }
      return { ...document, entities: document.entities.filter((entity) => entity.id !== command.id) };
    }

    case 'feature.create':
      return { ...document, features: [...document.features, command.feature] };

    case 'feature.update': {
      const existing = document.features.find((feature) => feature.id === command.id);
      if (!existing) {
        throw new UnknownFeatureError(command.id);
      }
      const updated = { ...existing, ...command.patch };
      return {
        ...document,
        features: document.features.map((feature) => (feature.id === command.id ? updated : feature)),
      };
    }

    case 'feature.delete': {
      const exists = document.features.some((feature) => feature.id === command.id);
      if (!exists) {
        throw new UnknownFeatureError(command.id);
      }
      return { ...document, features: document.features.filter((feature) => feature.id !== command.id) };
    }

    case 'batch':
      // Applied left-to-right against one document; a throw on any step aborts
      // the whole batch (the caller never sees a partially applied document).
      return command.commands.reduce((current, inner) => applyCommand(current, inner), document);

    default: {
      const exhaustive: never = command;
      throw new Error(`Unknown command type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
