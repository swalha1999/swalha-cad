import type { CadCommand } from './commands.js';
import type { CadDocumentV1 } from './types.js';

/** Thrown when a command references an entity id that is not present in the document. */
export class UnknownEntityError extends Error {
  readonly entityId: string;

  constructor(entityId: string) {
    super(`Unknown entity: ${entityId}`);
    this.name = 'UnknownEntityError';
    this.entityId = entityId;
  }
}

/** Deterministic, side-effect-free application of a command to a document, producing a new document. */
export function applyCommand(document: CadDocumentV1, command: CadCommand): CadDocumentV1 {
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

    default: {
      const exhaustive: never = command;
      throw new Error(`Unknown command type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
