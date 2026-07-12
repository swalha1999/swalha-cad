import type { CadDocumentV2, ExtrudeFeature, SketchEntity } from '@swalha-cad/document';
import { evaluateDocument } from '@swalha-cad/geometry';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCadStore } from './cad-store.js';

function rectangleEntities(): SketchEntity[] {
  return [
    { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
    { id: 'p1', kind: 'point', x: 40, y: 0, construction: false },
    { id: 'p2', kind: 'point', x: 40, y: 20, construction: false },
    { id: 'p3', kind: 'point', x: 0, y: 20, construction: false },
    { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
    { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
    { id: 'l3', kind: 'line', startId: 'p3', endId: 'p0', construction: false },
  ];
}

function documentWithSketch(entities = rectangleEntities()): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [],
    features: [{ id: 'sk1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints: [], visible: true }],
  };
}

type Store = ReturnType<typeof createCadStore>;

function storeWithSketch(entities = rectangleEntities()): Store {
  let n = 0;
  const store = createCadStore(documentWithSketch(entities), { createId: () => `gen-${++n}` });
  return store;
}

describe('cad-store extrude — starting the task', () => {
  it('opens the task seeded from the only sketch, at a default normal depth', () => {
    const store = storeWithSketch();
    store.getState().startExtrude();
    const session = store.getState().extrude;
    expect(session).toMatchObject({ editingFeatureId: null, sketchId: 'sk1', direction: 'normal', reverse: false });
    expect(session!.depth).toBeGreaterThan(0);
  });

  it('does nothing when the document has no sketch', () => {
    const store = createCadStore({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
    store.getState().startExtrude();
    expect(store.getState().extrude).toBeNull();
  });

  it('does not open while in sketch mode', () => {
    const store = storeWithSketch();
    store.getState().enterSketch('XY');
    store.getState().startExtrude();
    expect(store.getState().extrude).toBeNull();
  });

  it('clears any body/feature selection when opening', () => {
    const store = storeWithSketch();
    store.getState().selectFeature('sk1');
    store.getState().startExtrude();
    expect(store.getState().selectedFeatureId).toBeNull();
  });
});

describe('cad-store extrude — editing session fields', () => {
  let store: Store;
  beforeEach(() => {
    store = storeWithSketch();
    store.getState().startExtrude();
  });

  it('sets and clamps the depth', () => {
    store.getState().setExtrudeDepth(55);
    expect(store.getState().extrude!.depth).toBe(55);
    store.getState().setExtrudeDepth(-9);
    expect(store.getState().extrude!.depth).toBeGreaterThan(0);
  });

  it('toggles the operation direction', () => {
    store.getState().setExtrudeDirection('symmetric');
    expect(store.getState().extrude!.direction).toBe('symmetric');
  });

  it('toggles reverse', () => {
    store.getState().setExtrudeReverse(true);
    expect(store.getState().extrude!.reverse).toBe(true);
  });

  it('only accepts an existing sketch as the source', () => {
    store.getState().setExtrudeSource('nope');
    expect(store.getState().extrude!.sketchId).toBe('sk1');
  });
});

describe('cad-store extrude — confirm commits exactly one transaction', () => {
  it('creates one extrude feature and one history entry, then selects it', () => {
    const store = storeWithSketch();
    store.getState().startExtrude();
    store.getState().setExtrudeDepth(30);
    const outcome = store.getState().confirmExtrude();

    expect(outcome.committed).toBe(true);
    const state = store.getState();
    expect(state.extrude).toBeNull();
    const extrudes = state.document.features.filter((feature): feature is ExtrudeFeature => feature.kind === 'extrude');
    expect(extrudes).toHaveLength(1);
    expect(extrudes[0]).toMatchObject({ depth: 30, direction: 'normal' });
    expect(state.selectedFeatureId).toBe(outcome.featureId);

    // Exactly one undoable step: undo removes the extrude, restoring the prior state.
    expect(state.canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document.features.filter((f) => f.kind === 'extrude')).toHaveLength(0);
    store.getState().redo();
    expect(store.getState().document.features.filter((f) => f.kind === 'extrude')).toHaveLength(1);
  });

  it('rejects an invalid profile without mutating the document', () => {
    const openChain: SketchEntity[] = [
      { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p1', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    ];
    const store = storeWithSketch(openChain);
    store.getState().startExtrude();
    const outcome = store.getState().confirmExtrude();
    expect(outcome.committed).toBe(false);
    expect(outcome.message).toBeTruthy();
    // Panel stays open, nothing committed.
    expect(store.getState().extrude).not.toBeNull();
    expect(store.getState().document.features.filter((f) => f.kind === 'extrude')).toHaveLength(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('produces a renderable solid body from the committed feature', () => {
    const store = storeWithSketch();
    store.getState().startExtrude();
    store.getState().setExtrudeDepth(15);
    store.getState().confirmExtrude();
    const evaluated = evaluateDocument(store.getState().document);
    const solid = evaluated.bodies.find((body) => body.geometry.kind === 'mesh');
    expect(solid).toBeDefined();
    expect(evaluated.diagnostics).toHaveLength(0);
  });
});

describe('cad-store extrude — cancel restores prior state', () => {
  it('leaves the document and history untouched', () => {
    const store = storeWithSketch();
    const before = store.getState().document;
    store.getState().startExtrude();
    store.getState().setExtrudeDepth(40);
    store.getState().setExtrudeDirection('symmetric');
    store.getState().cancelExtrude();

    expect(store.getState().extrude).toBeNull();
    expect(store.getState().document).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('cad-store extrude — editing an existing feature', () => {
  function storeWithExtrude(): { store: Store; extrudeId: string } {
    const store = storeWithSketch();
    store.getState().startExtrude();
    store.getState().setExtrudeDepth(20);
    const { featureId } = store.getState().confirmExtrude();
    return { store, extrudeId: featureId! };
  }

  it('loads the existing feature values into the task', () => {
    const { store, extrudeId } = storeWithExtrude();
    store.getState().editExtrude(extrudeId);
    expect(store.getState().extrude).toMatchObject({ editingFeatureId: extrudeId, depth: 20, direction: 'normal' });
  });

  it('updates the same feature in one transaction on confirm', () => {
    const { store, extrudeId } = storeWithExtrude();
    store.getState().editExtrude(extrudeId);
    store.getState().setExtrudeDepth(65);
    store.getState().setExtrudeReverse(true);
    const outcome = store.getState().confirmExtrude();

    expect(outcome.featureId).toBe(extrudeId);
    const extrudes = store.getState().document.features.filter((f): f is ExtrudeFeature => f.kind === 'extrude');
    expect(extrudes).toHaveLength(1);
    expect(extrudes[0]).toMatchObject({ id: extrudeId, depth: 65, reverse: true });

    // One undoable step reverts the depth edit back to 20.
    store.getState().undo();
    const reverted = store.getState().document.features.find((f): f is ExtrudeFeature => f.kind === 'extrude');
    expect(reverted).toMatchObject({ depth: 20 });
  });

  it('closes an editing task when its feature is undone away', () => {
    const { store, extrudeId } = storeWithExtrude();
    store.getState().editExtrude(extrudeId);
    // Undo removes the extrude feature the task is editing.
    store.getState().undo();
    expect(store.getState().extrude).toBeNull();
  });
});
