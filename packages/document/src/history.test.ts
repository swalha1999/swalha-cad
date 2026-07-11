import { describe, expect, it } from 'vitest';
import { applyCommandToHistory, canRedo, canUndo, createHistory, redo, undo } from './history.js';
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

describe('command history', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistory(emptyDocument());

    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(history.present).toEqual(emptyDocument());
  });

  it('applies a command and records it as undoable', () => {
    const history = createHistory(emptyDocument());
    const entity = boxEntity('entity-1');

    const next = applyCommandToHistory(history, { type: 'entity.create', entity });

    expect(next.present.entities).toEqual([entity]);
    expect(canUndo(next)).toBe(true);
    expect(canRedo(next)).toBe(false);
  });

  it('does not mutate the prior history state when applying a command', () => {
    const history = createHistory(emptyDocument());
    const entity = boxEntity('entity-1');

    applyCommandToHistory(history, { type: 'entity.create', entity });

    expect(history.present.entities).toEqual([]);
    expect(canUndo(history)).toBe(false);
  });

  it('undo restores the previous document state', () => {
    const history = createHistory(emptyDocument());
    const entity = boxEntity('entity-1');
    const afterCreate = applyCommandToHistory(history, { type: 'entity.create', entity });

    const afterUndo = undo(afterCreate);

    expect(afterUndo.present.entities).toEqual([]);
    expect(canUndo(afterUndo)).toBe(false);
    expect(canRedo(afterUndo)).toBe(true);
  });

  it('redo re-applies the undone document state', () => {
    const history = createHistory(emptyDocument());
    const entity = boxEntity('entity-1');
    const afterCreate = applyCommandToHistory(history, { type: 'entity.create', entity });
    const afterUndo = undo(afterCreate);

    const afterRedo = redo(afterUndo);

    expect(afterRedo.present.entities).toEqual([entity]);
    expect(canUndo(afterRedo)).toBe(true);
    expect(canRedo(afterRedo)).toBe(false);
  });

  it('undo on an empty past is a no-op', () => {
    const history = createHistory(emptyDocument());

    const result = undo(history);

    expect(result).toBe(history);
  });

  it('redo on an empty future is a no-op', () => {
    const history = createHistory(emptyDocument());

    const result = redo(history);

    expect(result).toBe(history);
  });

  it('supports multiple undo/redo steps in order', () => {
    const history = createHistory(emptyDocument());
    const entityA = boxEntity('entity-1');
    const entityB = boxEntity('entity-2');

    const afterA = applyCommandToHistory(history, { type: 'entity.create', entity: entityA });
    const afterB = applyCommandToHistory(afterA, { type: 'entity.create', entity: entityB });

    const afterFirstUndo = undo(afterB);
    expect(afterFirstUndo.present.entities).toEqual([entityA]);

    const afterSecondUndo = undo(afterFirstUndo);
    expect(afterSecondUndo.present.entities).toEqual([]);

    const afterFirstRedo = redo(afterSecondUndo);
    expect(afterFirstRedo.present.entities).toEqual([entityA]);

    const afterSecondRedo = redo(afterFirstRedo);
    expect(afterSecondRedo.present.entities).toEqual([entityA, entityB]);
  });

  it('invalidates redo history after a new command is applied following an undo', () => {
    const history = createHistory(emptyDocument());
    const entityA = boxEntity('entity-1');
    const entityB = boxEntity('entity-2');
    const entityC = boxEntity('entity-3');

    const afterA = applyCommandToHistory(history, { type: 'entity.create', entity: entityA });
    const afterB = applyCommandToHistory(afterA, { type: 'entity.create', entity: entityB });
    const afterUndo = undo(afterB);
    expect(canRedo(afterUndo)).toBe(true);

    const afterNewCommand = applyCommandToHistory(afterUndo, { type: 'entity.create', entity: entityC });

    expect(canRedo(afterNewCommand)).toBe(false);
    expect(afterNewCommand.present.entities).toEqual([entityA, entityC]);

    const afterRedo = redo(afterNewCommand);
    expect(afterRedo).toBe(afterNewCommand);
  });

  it('propagates unknown entity errors from the underlying reducer', () => {
    const history = createHistory(emptyDocument());

    expect(() => applyCommandToHistory(history, { type: 'entity.delete', id: 'missing' })).toThrow();
  });
});
