import { describe, expect, it } from 'vitest';
import { applyCommand, UnknownEntityError } from './reducer.js';
import type { CadDocumentV1, CadEntity } from './types.js';

function boxEntity(id: string): CadEntity {
  return {
    id,
    name: 'box',
    primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
    transform: {
      translation: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
  };
}

function emptyDocument(): CadDocumentV1 {
  return { schemaVersion: 1, units: 'mm', entities: [] };
}

describe('applyCommand', () => {
  it('creates a new entity', () => {
    const document = emptyDocument();
    const entity = boxEntity('entity-1');

    const next = applyCommand(document, { type: 'entity.create', entity });

    expect(next.entities).toEqual([entity]);
  });

  it('does not mutate the original document or its entities array on create', () => {
    const document = emptyDocument();
    const entity = boxEntity('entity-1');

    const next = applyCommand(document, { type: 'entity.create', entity });

    expect(document.entities).toEqual([]);
    expect(next.entities).not.toBe(document.entities);
    expect(next).not.toBe(document);
  });

  it('updates an existing entity with a partial patch', () => {
    const document: CadDocumentV1 = { ...emptyDocument(), entities: [boxEntity('entity-1')] };

    const next = applyCommand(document, {
      type: 'entity.update',
      id: 'entity-1',
      patch: { name: 'renamed', visible: false },
    });

    expect(next.entities).toEqual([{ ...boxEntity('entity-1'), name: 'renamed', visible: false }]);
  });

  it('does not mutate the original document or entity on update', () => {
    const original = boxEntity('entity-1');
    const document: CadDocumentV1 = { ...emptyDocument(), entities: [original] };

    const next = applyCommand(document, { type: 'entity.update', id: 'entity-1', patch: { name: 'renamed' } });

    expect(document.entities[0]).toBe(original);
    expect(original.name).toBe('box');
    expect(next.entities).not.toBe(document.entities);
  });

  it('throws UnknownEntityError when updating a missing entity', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'entity.update', id: 'missing', patch: {} })).toThrow(
      UnknownEntityError,
    );
  });

  it('deletes an existing entity', () => {
    const document: CadDocumentV1 = {
      ...emptyDocument(),
      entities: [boxEntity('entity-1'), boxEntity('entity-2')],
    };

    const next = applyCommand(document, { type: 'entity.delete', id: 'entity-1' });

    expect(next.entities).toEqual([boxEntity('entity-2')]);
  });

  it('does not mutate the original document or its entities array on delete', () => {
    const document: CadDocumentV1 = { ...emptyDocument(), entities: [boxEntity('entity-1')] };

    const next = applyCommand(document, { type: 'entity.delete', id: 'entity-1' });

    expect(document.entities).toEqual([boxEntity('entity-1')]);
    expect(next.entities).not.toBe(document.entities);
  });

  it('throws UnknownEntityError when deleting a missing entity', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'entity.delete', id: 'missing' })).toThrow(UnknownEntityError);
  });

  it('includes the entity id on UnknownEntityError', () => {
    const document = emptyDocument();
    expect.assertions(2);

    try {
      applyCommand(document, { type: 'entity.delete', id: 'missing-entity' });
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownEntityError);
      expect((error as UnknownEntityError).entityId).toBe('missing-entity');
    }
  });
});
