import { describe, expect, it } from 'vitest';
import { createCadStore, selectSelectedEntity } from './cad-store.js';

describe('createCadStore', () => {
  it('starts with a seeded document, no selection, and a perspective camera', () => {
    const store = createCadStore();
    const state = store.getState();

    expect(state.document.schemaVersion).toBe(1);
    expect(state.document.units).toBe('mm');
    expect(state.document.entities.length).toBeGreaterThan(0);
    expect(state.selectedEntityId).toBeNull();
    expect(state.cameraProjection).toBe('perspective');
  });

  it('selects an entity that exists in the document', () => {
    const store = createCadStore();
    const firstId = store.getState().document.entities[0]!.id;

    store.getState().selectEntity(firstId);

    expect(store.getState().selectedEntityId).toBe(firstId);
  });

  it('clears the selection when given null', () => {
    const store = createCadStore();
    const firstId = store.getState().document.entities[0]!.id;
    store.getState().selectEntity(firstId);

    store.getState().selectEntity(null);

    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('ignores selection of an id that is not in the document', () => {
    const store = createCadStore();

    store.getState().selectEntity('does-not-exist');

    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('does not clear an existing selection when a later unknown id is selected', () => {
    const store = createCadStore();
    const firstId = store.getState().document.entities[0]!.id;
    store.getState().selectEntity(firstId);

    store.getState().selectEntity('does-not-exist');

    expect(store.getState().selectedEntityId).toBe(firstId);
  });

  it('switches the camera projection mode', () => {
    const store = createCadStore();

    store.getState().setCameraProjection('orthographic');
    expect(store.getState().cameraProjection).toBe('orthographic');

    store.getState().setCameraProjection('perspective');
    expect(store.getState().cameraProjection).toBe('perspective');
  });
});

describe('createEntity', () => {
  it('adds a box with sensible default dimensions and selects it', () => {
    const store = createCadStore();
    const before = store.getState().document.entities.length;

    const id = store.getState().createEntity('box');

    const state = store.getState();
    expect(state.document.entities).toHaveLength(before + 1);
    const created = state.document.entities.find((entity) => entity.id === id);
    expect(created?.primitive).toEqual({ kind: 'box', width: 40, height: 40, depth: 40 });
    expect(created?.transform).toEqual({ translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    expect(created?.visible).toBe(true);
    expect(state.selectedEntityId).toBe(id);
  });

  it('adds a cylinder with default radius/height/segments', () => {
    const store = createCadStore();

    const id = store.getState().createEntity('cylinder');

    const created = selectSelectedEntity(store.getState());
    expect(created?.id).toBe(id);
    expect(created?.primitive).toEqual({ kind: 'cylinder', radius: 20, height: 40, segments: 32 });
  });

  it('adds an l-bracket with a valid default thickness', () => {
    const store = createCadStore();

    store.getState().createEntity('lBracket');

    const created = selectSelectedEntity(store.getState());
    expect(created?.primitive).toEqual({ kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 });
  });

  it('disambiguates the default name when one already exists', () => {
    const store = createCadStore({ schemaVersion: 1, units: 'mm', entities: [] });

    store.getState().createEntity('box');
    store.getState().createEntity('box');

    const names = store.getState().document.entities.map((entity) => entity.name);
    expect(names).toEqual(['Box', 'Box 2']);
  });

  it('assigns each new entity a unique id', () => {
    const store = createCadStore({ schemaVersion: 1, units: 'mm', entities: [] });

    const first = store.getState().createEntity('box');
    const second = store.getState().createEntity('box');

    expect(first).not.toBe(second);
  });

  it('makes the create undoable', () => {
    const store = createCadStore();
    const before = store.getState().document.entities.length;

    expect(store.getState().canUndo).toBe(false);
    store.getState().createEntity('box');
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();
    expect(store.getState().document.entities).toHaveLength(before);
  });
});

describe('updateEntity', () => {
  it('applies a valid dimension patch', () => {
    const store = createCadStore();
    const id = store.getState().document.entities[0]!.id;

    const ok = store.getState().updateEntity(id, { primitive: { kind: 'box', width: 99, height: 30, depth: 20 } });

    expect(ok).toBe(true);
    const updated = store.getState().document.entities.find((entity) => entity.id === id);
    expect(updated?.primitive).toEqual({ kind: 'box', width: 99, height: 30, depth: 20 });
  });

  it('applies a valid transform patch', () => {
    const store = createCadStore();
    const id = store.getState().document.entities[0]!.id;

    const ok = store.getState().updateEntity(id, {
      transform: { translation: [1, 2, 3], rotationDeg: [0, 90, 0], scale: [1, 1, 1] },
    });

    expect(ok).toBe(true);
    const updated = store.getState().document.entities.find((entity) => entity.id === id);
    expect(updated?.transform).toEqual({ translation: [1, 2, 3], rotationDeg: [0, 90, 0], scale: [1, 1, 1] });
  });

  it('rejects a non-positive dimension and leaves the document unchanged', () => {
    const store = createCadStore();
    const id = store.getState().document.entities[0]!.id;
    const before = store.getState().document;

    const ok = store.getState().updateEntity(id, { primitive: { kind: 'box', width: 0, height: 30, depth: 20 } });

    expect(ok).toBe(false);
    expect(store.getState().document).toBe(before);
  });

  it('rejects an l-bracket thickness that is not strictly less than width/height', () => {
    const store = createCadStore();
    const id = store.getState().document.entities.find((entity) => entity.primitive.kind === 'lBracket')!.id;

    const ok = store.getState().updateEntity(id, {
      primitive: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 50 },
    });

    expect(ok).toBe(false);
  });

  it('rejects an update for an unknown entity id', () => {
    const store = createCadStore();

    const ok = store.getState().updateEntity('missing', { visible: false });

    expect(ok).toBe(false);
  });

  it('makes a valid update undoable', () => {
    const store = createCadStore();
    const id = store.getState().document.entities[0]!.id;

    store.getState().updateEntity(id, { primitive: { kind: 'box', width: 99, height: 30, depth: 20 } });
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();
    const restored = store.getState().document.entities.find((entity) => entity.id === id);
    expect(restored?.primitive).toEqual({ kind: 'box', width: 40, height: 30, depth: 20 });
  });
});

describe('undo/redo', () => {
  it('reports canUndo/canRedo across a create, undo, and redo cycle', () => {
    const store = createCadStore();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);

    store.getState().createEntity('box');
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(false);

    store.getState().undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    store.getState().redo();
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(false);
  });

  it('is a no-op when there is nothing to undo or redo', () => {
    const store = createCadStore();
    const document = store.getState().document;

    store.getState().undo();
    store.getState().redo();

    expect(store.getState().document).toBe(document);
  });

  it('clears the selection when undo removes the selected entity', () => {
    const store = createCadStore();
    const id = store.getState().createEntity('box');
    expect(store.getState().selectedEntityId).toBe(id);

    store.getState().undo();

    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('discards redo history once a new command is applied after undo', () => {
    const store = createCadStore();
    store.getState().createEntity('box');
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);

    store.getState().createEntity('cylinder');

    expect(store.getState().canRedo).toBe(false);
  });
});

describe('selectSelectedEntity', () => {
  it('returns undefined when nothing is selected', () => {
    const store = createCadStore();

    expect(selectSelectedEntity(store.getState())).toBeUndefined();
  });

  it('returns the entity matching the selected id', () => {
    const store = createCadStore();
    const target = store.getState().document.entities[1]!;
    store.getState().selectEntity(target.id);

    expect(selectSelectedEntity(store.getState())).toEqual(target);
  });
});
