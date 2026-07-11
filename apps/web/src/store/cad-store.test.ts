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
